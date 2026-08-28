import { findField } from './evaluate';
import type { PropertyResult } from './types';

/** Property detail URLs look like /tochi/[area/]1234567/ — the digits are the id. */
const DETAIL_URL_RE = /www\.athome\.co\.jp\/tochi\/(?:[^/\d][^/]*\/)?(\d{7,})\//;

/** Results per list page requested from the site. */
const PAGE_SIZE = 30;

/** Give up paging after this many consecutive pages that add nothing new. */
const MAX_EMPTY_PAGES = 2;

/** Hard stop so a bad URL pattern can never spin forever. */
const MAX_PAGES = 40;

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class AbortedError extends Error {
  constructor() {
    super('中断しました');
    this.name = 'AbortedError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError();
}

function detailUrlFromId(id: string): string {
  return `https://www.athome.co.jp/tochi/${id}/`;
}

/** Collects unique detail URLs out of any document, preserving DOM order. */
export function extractDetailLinks(root: Document | ParentNode, baseUrl: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const anchor of root.querySelectorAll('a[href]')) {
    const raw = anchor.getAttribute('href');
    if (!raw) continue;

    let href: string;
    try {
      href = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }

    const match = href.match(DETAIL_URL_RE);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    urls.push(detailUrlFromId(match[1]));
  }

  return urls;
}

/** Rewrites a list URL to point at `page`, keeping the search conditions intact. */
export function buildPageUrl(baseUrl: string, page: number): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/list\/\d+\/?$/, '/list/');
  if (!path.endsWith('/')) path += '/';
  if (page > 1) path = path.replace(/\/list\/$/, `/list/${page}/`);
  url.pathname = path;
  url.searchParams.set('limit', String(PAGE_SIZE));
  return url.toString();
}

async function fetchDocument(url: string, signal?: AbortSignal): Promise<Document | null> {
  const res = await fetch(url, { credentials: 'include', signal });
  if (!res.ok) return null;
  return new DOMParser().parseFromString(await res.text(), 'text/html');
}

export interface LinkStreamOptions {
  baseUrl: string;
  delayMs: number;
  signal?: AbortSignal;
  /** Links found in the already-rendered first page, if any. */
  seedLinks?: string[];
  /** Called once per list page read, with the running totals. */
  onPage?: (pagesCrawled: number, linksSeen: number) => void;
}

/**
 * Yields unique detail URLs, pulling in the next list page only once the caller
 * has consumed everything found so far. The caller decides when to stop — it
 * knows how many properties actually passed the filters, which is what the
 * requested count refers to.
 */
export async function* streamDetailLinks(options: LinkStreamOptions): AsyncGenerator<string> {
  const { baseUrl, delayMs, signal, seedLinks = [], onPage } = options;

  const seen = new Set<string>();
  let pagesCrawled = 0;

  if (seedLinks.length > 0) {
    pagesCrawled = 1;
    const fresh = [...new Set(seedLinks)];
    fresh.forEach(link => seen.add(link));
    onPage?.(pagesCrawled, seen.size);
    yield* fresh;
  }

  let page = pagesCrawled + 1;
  let emptyPages = 0;

  while (page <= MAX_PAGES && emptyPages < MAX_EMPTY_PAGES) {
    throwIfAborted(signal);
    await sleep(delayMs);

    const url = buildPageUrl(baseUrl, page);
    const doc = await fetchDocument(url, signal);
    if (!doc) break;

    pagesCrawled++;
    page++;

    const fresh = extractDetailLinks(doc, url).filter(link => !seen.has(link));
    if (fresh.length === 0) emptyPages++;
    else emptyPages = 0;

    fresh.forEach(link => seen.add(link));
    onPage?.(pagesCrawled, seen.size);
    yield* fresh;
  }
}

/**
 * Strips interactive chrome out of a cell before reading it, so values don't
 * pick up junk like 「地図を見る」 that the site renders inside table cells.
 */
function cleanText(el: Element | null | undefined): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  for (const junk of clone.querySelectorAll(
    'a, button, script, style, input, select, [role="button"]'
  )) {
    junk.remove();
  }
  return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Reads every th/td and dt/dd pair on a detail page into a flat field map. */
export function parseDetailFields(doc: Document): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const row of doc.querySelectorAll('tr')) {
    const headers = [...row.querySelectorAll('th')];
    const cells = [...row.querySelectorAll('td')];
    headers.forEach((th, i) => {
      const key = th.textContent?.replace(/\s+/g, '') ?? '';
      if (key) fields[key] = cleanText(cells[i]);
    });
  }

  for (const dt of doc.querySelectorAll('dl dt')) {
    const dd = dt.nextElementSibling;
    if (dd?.tagName !== 'DD') continue;
    const key = dt.textContent?.replace(/\s+/g, '') ?? '';
    if (key) fields[key] = cleanText(dd);
  }

  return fields;
}

/**
 * The listing's own name. athome prints it in the page heading — either a
 * development name (「【積水ハウス】コモンステージ武蔵村山大南」) or just the
 * neighbourhood (「久が原３丁目」). Falls back to the address when a page has
 * no heading at all.
 */
function readName(doc: Document, fields: Record<string, string>, location: string): string {
  const heading = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
  return heading || findField(fields, '物件名') || location;
}

/**
 * The price cell is assembled from separate spans (「1億」「500万円」), so the
 * whitespace between them has to go before it reads as a single amount.
 */
function readPrice(fields: Record<string, string>): string {
  return findField(fields, '価格').replace(/\s+/g, '');
}

export type DetailData = Omit<PropertyResult, 'url' | 'passed' | 'reasons'>;

export async function fetchDetail(url: string, signal?: AbortSignal): Promise<DetailData | null> {
  let doc: Document | null;
  try {
    doc = await fetchDocument(url, signal);
  } catch (err) {
    if (signal?.aborted) throw new AbortedError();
    console.warn('[AGF] 詳細取得に失敗:', url, err);
    return null;
  }
  if (!doc) return null;

  const fields = parseDetailFields(doc);
  const location = findField(fields, '所在地');

  return {
    fields,
    name: readName(doc, fields, location),
    price: readPrice(fields),
    area: findField(fields, '土地面積'),
    location,
    traffic: findField(fields, '交通')
  };
}
