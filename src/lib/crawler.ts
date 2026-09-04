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
  parseDetailFields,
  parseListingCards,
  parseTotalCount,
  readDetailName
} from './markup';
import { listingsFromState } from './state';
import type { Listing, PropertyResult, StopReason } from './types';

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

/**
 * Parameters athome adds for its own bookkeeping rather than to describe the
 * search, which would otherwise make the same search look like a new one.
 */
const INCIDENTAL_PARAMS = ['limit', 'page', 'sref', 'DOWN', 'BKLISTID', 'SEARCHDIV'];

/**
 * The identity of a search, independent of where in it you happen to be. Page
 * five of a search has to key the same as page one, or a resumed run would
 * remember nothing.
 */
export function canonicalSearchKey(searchUrl: string): string {
  const url = new URL(searchUrl);
  url.pathname = url.pathname.replace(/\/list\/(?:page)?\d+\/?$/, '/list/');
  url.hash = '';

  for (const name of INCIDENTAL_PARAMS) url.searchParams.delete(name);
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(params).toString();

  return url.toString();
}

/** How many list pages `total` hits fill. Null when the count is unknown. */
export function expectedPages(total: number | null, pageSize: number): number | null {
  if (total === null || pageSize <= 0) return null;
  return Math.ceil(total / pageSize);
}

/**
 * Where a list page's properties came from. Each step down loses fields, and
 * with them the chance to rule a property out before opening its detail page,
 * so which one a run ended up on is worth reporting rather than hiding.
 */
export type ListingSource = 'state' | 'cards' | 'links';

/** What a list crawl learned on the way, and how it ended. */
export interface ListCrawlReport {
  pagesCrawled: number;
  /** athome's own hit count for the search, once a page has been read. */
  totalCount: number | null;
  /** Why the list crawl stopped, or null while it is still running. */
  stoppedBy: StopReason | null;
  /** The poorest source any page had to fall back to. */
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

/**
 * Reads a list page as properties, richest source first. athome's own transfer
 * state carries the most; the rendered cards carry less; a sweep for detail
 * links carries nothing but the URLs, and exists only so a redesign degrades
 * the crawl instead of stopping it.
 */
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
  /** Shared with the detail fetches, so one crawl has one pace. */
  pacer?: Pacer;
  /** Filled in as the crawl runs, so the caller can report how it ended. */
  report: ListCrawlReport;
  /** Called once per list page read, with the running totals. */
  onPage?: (report: ListCrawlReport, linksSeen: number) => void;
}

/**
 * Yields unique listings, pulling in the next list page only once the caller
 * has consumed everything found so far. The caller decides when to stop — it
 * knows how many properties actually passed the filters, which is what the
 * requested count refers to.
 *
 * The first page is fetched like any other rather than taken from the tab that
 * started the run: the rendered page carries whatever page size the user had
 * selected, and its markup also holds recommendation panels whose links are not
 * search results at all.
 */
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

    const listings = readListPage(outcome.html, outcome.doc, url, report);
    const ids = listings.map(listing => listing.id);

    // athome answers a page number it does not understand by serving page one,
    // so a page identical to the one before it means paging is broken rather
    // than that the results ran out.
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
    name: readDetailName(doc, fields, location),
    price: readPrice(fields),
    area: findField(fields, '土地面積'),
    location,
    traffic: findField(fields, '交通')
  };
}
