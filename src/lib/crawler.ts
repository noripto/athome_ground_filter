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
import {
  bareListing,
  extractDetailLinks,
  parseCompany,
  parseDetailFields,
  parseListingCards,
  parseTotalCount,
  readDetailName
} from './markup';
import { LISTED_COMPANY_FIELD, PARTY_PAGE_FIELD } from './party';
import { listingsFromState } from './state';
import type { Listing, PropertyResult, StopReason } from './types';

export function buildPageUrl(baseUrl: string, page: number, pageSize = LIST_PAGE_SIZE): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/list\/(?:page)?\d+\/?$/, '/list/');
  if (!path.endsWith('/')) path += '/';
  if (page > 1) path = path.replace(/\/list\/$/, `/list/page${page}/`);
  url.pathname = path;
  url.searchParams.set('limit', String(pageSize));
  return url.toString();
}

const INCIDENTAL_PARAMS = ['limit', 'page', 'sref', 'DOWN', 'BKLISTID', 'SEARCHDIV'];

export function canonicalSearchKey(searchUrl: string): string {
  const url = new URL(searchUrl);
  url.pathname = url.pathname.replace(/\/list\/(?:page)?\d+\/?$/, '/list/');
  url.hash = '';

  for (const name of INCIDENTAL_PARAMS) url.searchParams.delete(name);
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(params).toString();

  return url.toString();
}

export function expectedPages(total: number | null, pageSize: number): number | null {
  if (total === null || pageSize <= 0) return null;
  return Math.ceil(total / pageSize);
}

export type ListingSource = 'state' | 'cards' | 'links';

export interface ListCrawlReport {
  pagesCrawled: number;
  totalCount: number | null;
  stoppedBy: StopReason | null;
  source: ListingSource | null;
}

export function newListCrawlReport(): ListCrawlReport {
  return { pagesCrawled: 0, totalCount: null, stoppedBy: null, source: null };
}

const SOURCE_RANK: Record<ListingSource, number> = { state: 0, cards: 1, links: 2 };

function noteSource(report: ListCrawlReport, source: ListingSource): void {
  if (report.source === null || SOURCE_RANK[source] > SOURCE_RANK[report.source]) {
    report.source = source;
  }
}

function readListPage(
  html: string,
  doc: Document,
  url: string,
  report: ListCrawlReport
): Listing[] {
  const fromState = listingsFromState(html);
  if (fromState.length > 0) {
    noteSource(report, 'state');
    return fromState;
  }

  const cards = parseListingCards(doc, url);
  if (cards.length > 0) {
    noteSource(report, 'cards');
    return cards;
  }

  const links = extractDetailLinks(doc, url);
  if (links.length > 0) noteSource(report, 'links');
  return links.map(bareListing);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((id, i) => id === b[i]);
}

export interface LinkStreamOptions {
  baseUrl: string;
  delayMs: number;
  pageSize?: number;
  signal?: AbortSignal;
  pacer?: Pacer;
  report: ListCrawlReport;
  onPage?: (report: ListCrawlReport, linksSeen: number) => void;
}

export async function* streamListings(options: LinkStreamOptions): AsyncGenerator<Listing> {
  const { baseUrl, delayMs, pageSize = LIST_PAGE_SIZE, signal, pacer, report, onPage } = options;

  const seen = new Set<string>();
  let previousIds: string[] = [];
  let page = 1;

  while (page <= MAX_LIST_PAGES) {
    throwIfAborted(signal);
    await sleep(paceDelay(delayMs, pacer?.cooldownMs), signal);

    const url = buildPageUrl(baseUrl, page, pageSize);
    const outcome = await fetchPage(url, { signal, pacer });

    if (outcome.kind !== 'ok') {
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

    const listings = readListPage(outcome.html, outcome.doc, url, report);
    const ids = listings.map(listing => listing.id);

    if (sameIds(ids, previousIds)) {
      report.stoppedBy = 'paging';
      return;
    }
    previousIds = ids;

    report.pagesCrawled = page;
    const fresh = listings.filter(listing => !seen.has(listing.id));
    fresh.forEach(listing => seen.add(listing.id));
    onPage?.(report, seen.size);
    yield* fresh;

    if (listings.length === 0) {
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

function readPrice(fields: Record<string, string>): string {
  return findField(fields, '価格').replace(/\s+/g, '');
}

export type DetailData = Omit<PropertyResult, 'url' | 'passed' | 'reasons'>;

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

  const company = parseCompany(doc, url);
  if (company.name) fields[LISTED_COMPANY_FIELD] = company.name;
  if (company.page) fields[PARTY_PAGE_FIELD] = company.page;

  return {
    fields,
    name: readDetailName(doc, fields, location),
    price: readPrice(fields),
    area: findField(fields, '土地面積'),
    location,
    traffic: findField(fields, '交通')
  };
}
