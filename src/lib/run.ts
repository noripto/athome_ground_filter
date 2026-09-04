import { MAX_DETAIL_FETCHES } from './config';
import {
  canonicalSearchKey,
  fetchDetail,
  newListCrawlReport,
  streamListings,
  type ListCrawlReport
} from './crawler';
import { getDetail, isFresh, putDetail, putListing, putSearch } from './db';
import { describeActiveFilters, evaluate } from './evaluate';
import { AbortedError, BlockedError, newPacer, paceDelay, sleep } from './fetcher';
import type { Detail, Listing, PropertyResult, ResultSet, Settings, StopReason } from './types';

export interface RunProgress {
  phase: 'list' | 'detail' | 'done';
  message: string;
  /** Passing properties found so far. */
  current: number;
  /** Passing properties still wanted. */
  total: number;
}

export interface RunOptions {
  searchUrl: string;
  settings: Settings;
  signal?: AbortSignal;
  onProgress?: (progress: RunProgress) => void;
}

/**
 * Ceiling on detail pages opened in one run, so that a filter set nothing can
 * satisfy stops instead of walking the entire search. A「全件」run has no goal
 * to stop at, so it gets the standing ceiling instead of one scaled to a goal.
 */
export function inspectLimitFor(target: number): number {
  if (target <= 0) return MAX_DETAIL_FETCHES;
  return Math.min(1200, Math.max(200, target * 10));
}

/**
 * A goal met, or a cap hit, outranks however the list crawl ended: both mean
 * the run stopped on purpose with the results it was asked for.
 */
export function resolveStopReason(
  report: ListCrawlReport,
  passed: number,
  target: number,
  inspected: number,
  inspectLimit: number
): StopReason {
  if (target > 0 && passed >= target) return 'target';
  if (inspected >= inspectLimit) return 'limit';
  return report.stoppedBy ?? 'exhausted';
}

/**
 * Whatever the card said is worth keeping even when the detail page could not
 * be read, so a failed property still shows up as something recognisable.
 */
function failedResult(listing: Listing): PropertyResult {
  return {
    url: listing.url,
    passed: false,
    reasons: ['詳細ページの取得に失敗しました'],
    name: listing.name,
    price: listing.price,
    area: listing.area,
    location: listing.location,
    traffic: listing.traffic,
    fields: listing.fields
  };
}

/** A property ruled out by its card alone, with no detail page ever opened. */
function prefilteredResult(listing: Listing, reasons: string[]): PropertyResult {
  return {
    url: listing.url,
    passed: false,
    reasons,
    name: listing.name,
    price: listing.price,
    area: listing.area,
    location: listing.location,
    traffic: listing.traffic,
    fields: listing.fields
  };
}

/**
 * Walks the search results until `settings.targetCount` properties have *passed*
 * the filters — excluded ones do not count towards the goal, and zero means
 * every result there is — reporting progress as it goes. Cancelling through
 * `signal` ends the run and returns what it has, rather than failing.
 */
export async function runFilter(options: RunOptions): Promise<ResultSet> {
  const { searchUrl, settings, signal, onProgress } = options;
  const target = settings.targetCount;
  const inspectLimit = inspectLimitFor(target);

  const properties: PropertyResult[] = [];
  const report = newListCrawlReport();
  // One pace for the whole run: a challenge met while reading list pages has
  // to slow the detail fetches down too, or the crawl walks straight back into
  // the same wall.
  const pacer = newPacer();
  const startedAt = Date.now();
  const searchKey = canonicalSearchKey(searchUrl);
  const maxAgeMs = settings.detailMaxAgeDays * 24 * 60 * 60 * 1000;
  const seenIds: string[] = [];
  let inspected = 0;
  let passed = 0;
  let excluded = 0;
  let failed = 0;
  let skipped = 0;
  let cached = 0;

  const listings = streamListings({
    baseUrl: searchUrl,
    delayMs: settings.requestDelayMs,
    signal,
    pacer,
    report,
    onPage: (progress, seen) => {
      const of = progress.totalCount === null ? '' : ` / 全 ${progress.totalCount}件`;
      onProgress?.({
        phase: 'list',
        message: `リスト ${progress.pagesCrawled} ページ目（候補 ${seen}件${of}）`,
        current: passed,
        total: target
      });
    }
  });

  try {
    for await (const listing of listings) {
      if (signal?.aborted) throw new AbortedError();
      if (target > 0 && passed >= target) break;
      if (inspected >= inspectLimit) break;

      seenIds.push(listing.id);
      void putListing({ ...listing, seenAt: startedAt });

      // The card already answers some of the filters. Ruling a property out
      // here costs nothing; the detail page it saves is a whole request.
      const cardReasons = evaluate(settings.filters, listing.fields, { presentFieldsOnly: true });
      if (cardReasons.length > 0) {
        excluded++;
        skipped++;
        properties.push(prefilteredResult(listing, cardReasons));
        continue;
      }

      // A detail page already read is the whole point of keeping them: what it
      // says does not change, so a second run over the same search only pays
      // for the properties that are new.
      const stored = await getDetail(listing.id);
      let detail: Detail | null = isFresh(stored, startedAt, maxAgeMs) ? (stored ?? null) : null;

      if (detail) {
        cached++;
      } else {
        if (inspected > 0) await sleep(paceDelay(settings.requestDelayMs, pacer.cooldownMs));

        inspected++;
        onProgress?.({
          phase: 'detail',
          message:
            target > 0
              ? `合致 ${passed} / ${target}件（${inspected}件目を取得中、キャッシュ ${cached}件）`
              : `合致 ${passed}件（${inspected}件目を取得中、キャッシュ ${cached}件）`,
          current: passed,
          total: target
        });

        const fetched = await fetchDetail(listing.url, signal, pacer);
        if (!fetched) {
          failed++;
          properties.push(failedResult(listing));
          continue;
        }

        detail = { id: listing.id, fetchedAt: Date.now(), ...fetched };
        void putDetail(detail);
      }

      const reasons = evaluate(settings.filters, detail.fields);
      if (reasons.length === 0) passed++;
      else excluded++;
      properties.push({
        url: listing.url,
        passed: reasons.length === 0,
        reasons,
        name: detail.name,
        price: detail.price,
        area: detail.area,
        location: detail.location,
        traffic: detail.traffic,
        fields: detail.fields
      });
    }
  } catch (err) {
    // Both of these end the run rather than fail it. A crawl of a whole search
    // runs long enough that throwing away what it already read — because the
    // user pressed cancel, or because the site started challenging — would be
    // the worse outcome by far.
    if (err instanceof AbortedError) report.stoppedBy = 'aborted';
    else if (err instanceof BlockedError) report.stoppedBy = 'blocked';
    else throw err;
  }

  const stoppedBy = resolveStopReason(report, passed, target, inspected, inspectLimit);

  await putSearch({
    searchKey,
    searchUrl,
    totalCount: report.totalCount,
    pagesCrawled: report.pagesCrawled,
    listingIds: seenIds,
    startedAt,
    updatedAt: Date.now(),
    finishedAt: Date.now(),
    stoppedBy
  });

  onProgress?.({
    phase: 'done',
    message: `完了 — 合致 ${passed}件（取得 ${inspected}件、キャッシュ ${cached}件）`,
    current: passed,
    total: target
  });

  return {
    timestamp: Date.now(),
    searchUrl,
    requested: target,
    totalCount: report.totalCount,
    inspected,
    passed,
    excluded,
    failed,
    skipped,
    cached,
    pagesCrawled: report.pagesCrawled,
    stoppedBy,
    inspectLimit,
    activeFilters: describeActiveFilters(settings.filters),
    properties: settings.keepExcluded ? properties : properties.filter(p => p.passed)
  };
}
