import { LIST_PAGE_SIZE, MAX_LIST_PAGES } from './config';
import { findField } from './evaluate';
import {
  AbortedError,
  BlockedError,
  fetchPage,
  paceDelay,
  sleep,
  throwIfAborted,
  type Pacer,
  type PageOutcome
} from './fetcher';
import type { PropertyResult, StopReason } from './types';

/** Property detail URLs look like /tochi/[area/]1234567/ — the digits are the id. */
const DETAIL_URL_RE = /www\.athome\.co\.jp\/tochi\/(?:[^/\d][^/]*\/)?(\d{7,})\//;

/**
 * athome prints the hit count for the current search in the page header, split
 * across spans, so the number is read by anchoring on the class rather than on
 * the surrounding text.
 */
const TOTAL_COUNT_RE = /area-top__property--number[^>]*>\s*([\d,]+)\s*</;

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

/**
 * Rewrites a list URL to point at `page`, keeping the search conditions intact.
 * athome numbers its list pages with a `pageN` path segment — a bare `/list/2/`
 * answers 404, which is what used to end a crawl right after its first page.
 */
export function buildPageUrl(baseUrl: string, page: number, pageSize = LIST_PAGE_SIZE): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/list\/(?:page)?\d+\/?$/, '/list/');
  if (!path.endsWith('/')) path += '/';
  if (page > 1) path = path.replace(/\/list\/$/, `/list/page${page}/`);
  url.pathname = path;
  url.searchParams.set('limit', String(pageSize));
  return url.toString();
}

/** The hit count athome reports for a search, or null if the page omits it. */
export function parseTotalCount(html: string): number | null {
  const match = html.match(TOTAL_COUNT_RE);
  if (!match) return null;
  const count = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(count) ? count : null;
}

/** How many list pages `total` hits fill. Null when the count is unknown. */
export function expectedPages(total: number | null, pageSize: number): number | null {
  if (total === null || pageSize <= 0) return null;
  return Math.ceil(total / pageSize);
}

/** What a list crawl learned on the way, and how it ended. */
export interface ListCrawlReport {
  pagesCrawled: number;
  /** athome's own hit count for the search, once a page has been read. */
  totalCount: number | null;
  /** Why the list crawl stopped, or null while it is still running. */
  stoppedBy: StopReason | null;
}

export function newListCrawlReport(): ListCrawlReport {
  return { pagesCrawled: 0, totalCount: null, stoppedBy: null };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((id, i) => id === b[i]);
}

export interface LinkStreamOptions {
  baseUrl: string;
  delayMs: number;
  pageSize?: number;
  signal?: AbortSignal;
  /** Shared with the detail fetches, so one crawl has one pace. */
  pacer?: Pacer;
  /** Filled in as the crawl runs, so the caller can report how it ended. */
  report: ListCrawlReport;
  /** Called once per list page read, with the running totals. */
  onPage?: (report: ListCrawlReport, linksSeen: number) => void;
}

/**
 * Yields unique detail URLs, pulling in the next list page only once the caller
 * has consumed everything found so far. The caller decides when to stop — it
 * knows how many properties actually passed the filters, which is what the
 * requested count refers to.
 *
 * The first page is fetched like any other rather than taken from the tab that
 * started the run: the rendered page carries whatever page size the user had
 * selected, and its markup also holds recommendation panels whose links are not
 * search results at all.
 */
export async function* streamDetailLinks(options: LinkStreamOptions): AsyncGenerator<string> {
  const { baseUrl, delayMs, pageSize = LIST_PAGE_SIZE, signal, pacer, report, onPage } = options;

  const seen = new Set<string>();
  let previousIds: string[] = [];
  let page = 1;

  while (page <= MAX_LIST_PAGES) {
    throwIfAborted(signal);
    await sleep(paceDelay(delayMs, pacer?.cooldownMs));

    const url = buildPageUrl(baseUrl, page, pageSize);
    const outcome = await fetchPage(url, { signal, pacer });

    if (outcome.kind !== 'ok') {
      // Past the last page athome will serve, a page number 404s. Everything
      // else is a failure the run should own up to rather than report as a
      // search that ran dry.
      report.stoppedBy =
        outcome.kind === 'notfound'
          ? page > 1
            ? 'exhausted'
            : 'http'
          : outcome.kind === 'challenged'
            ? 'blocked'
            : 'http';
      return;
    }

    if (report.totalCount === null) report.totalCount = parseTotalCount(outcome.html);

    const ids = extractDetailLinks(outcome.doc, url);

    // athome answers a page number it does not understand by serving page one,
    // so a page identical to the one before it means paging is broken rather
    // than that the results ran out.
    if (sameIds(ids, previousIds)) {
      report.stoppedBy = 'paging';
      return;
    }
    previousIds = ids;

    report.pagesCrawled = page;
    const fresh = ids.filter(link => !seen.has(link));
    fresh.forEach(link => seen.add(link));
    onPage?.(report, seen.size);
    yield* fresh;

    if (ids.length === 0) {
      report.stoppedBy = 'exhausted';
      return;
    }

    const lastPage = expectedPages(report.totalCount, pageSize);
    if (lastPage !== null && page >= lastPage) {
      report.stoppedBy = 'complete';
      return;
    }

    page++;
  }

  report.stoppedBy = 'limit';
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

/**
 * Reads one detail page. A missing or broken page is that property's problem
 * and returns null, but a bot check is the whole run's problem: every later
 * fetch would fail the same way, quietly burning through the inspection budget
 * as if the filters were simply strict.
 */
export async function fetchDetail(
  url: string,
  signal?: AbortSignal,
  pacer?: Pacer
): Promise<DetailData | null> {
  let outcome: PageOutcome;
  try {
    outcome = await fetchPage(url, { signal, pacer });
  } catch (err) {
    if (err instanceof AbortedError) throw err;
    console.warn('[AGF] 詳細取得に失敗:', url, err);
    return null;
  }

  if (outcome.kind === 'challenged') throw new BlockedError();
  if (outcome.kind !== 'ok') return null;

  const doc = outcome.doc;
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
