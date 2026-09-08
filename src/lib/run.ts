import { MAX_DETAIL_FETCHES } from './config';
import {
  buildPageUrl,
  canonicalSearchKey,
  fetchDetail,
  newListCrawlReport,
  streamListings,
  type ListCrawlReport,
  type ListingSource
} from './crawler';
import { getDetail, isFresh, putDetail, putListing, putSearch } from './db';
import { describeActiveFilters, evaluate } from './evaluate';
import { AbortedError, BlockedError, fetchPage, newPacer, paceDelay, sleep } from './fetcher';
import { parseTotalCount } from './markup';
import { carryParty } from './party';
import { narrowSearchUrl } from './search-url';
import type { Detail, Listing, PropertyResult, ResultSet, Settings, StopReason } from './types';

export interface RunTallies {
  inspected: number;
  passed: number;
  excluded: number;
  failed: number;
  skipped: number;
  cached: number;
  pagesCrawled: number;
  totalCount: number | null;
  source: ListingSource | null;
}

export interface RunProgress {
  phase: 'list' | 'detail' | 'done';
  message: string;
  current: number;
  total: number;
  tallies: RunTallies;
}

export interface RunOptions {
  searchUrl: string;
  settings: Settings;
  signal?: AbortSignal;
  onProgress?: (progress: RunProgress) => void;
  onProperty?: (property: PropertyResult) => void;
}

export function inspectLimitFor(target: number): number {
  if (target <= 0) return MAX_DETAIL_FETCHES;
  return Math.min(1200, Math.max(200, target * 10));
}

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

export async function runFilter(options: RunOptions): Promise<ResultSet> {
  const { searchUrl, settings, signal, onProgress, onProperty } = options;
  const target = settings.targetCount;
  const inspectLimit = inspectLimitFor(target);

  const properties: PropertyResult[] = [];
  const report = newListCrawlReport();
  const pacer = newPacer();
  const startedAt = Date.now();
  const maxAgeMs = settings.detailMaxAgeDays * 24 * 60 * 60 * 1000;
  const seenIds: string[] = [];
  let inspected = 0;
  let passed = 0;
  let excluded = 0;
  let failed = 0;
  let skipped = 0;
  let cached = 0;

  const tallies = (): RunTallies => ({
    inspected,
    passed,
    excluded,
    failed,
    skipped,
    cached,
    pagesCrawled: report.pagesCrawled,
    totalCount: report.totalCount,
    source: report.source
  });

  const record = (property: PropertyResult): void => {
    properties.push(property);
    onProperty?.(property);
  };

  let crawlUrl = searchUrl;
  let narrowedBy: string[] = [];
  let countBefore: number | null = null;

  if (settings.narrowOnAthome) {
    onProgress?.({
      phase: 'list',
      message: 'athome 側で絞り込めるか確認中…',
      current: 0,
      total: target,
      tallies: tallies()
    });

    try {
      const first = await fetchPage(buildPageUrl(searchUrl, 1), { signal, pacer });
      if (first.kind === 'ok') {
        countBefore = parseTotalCount(first.html);
        const narrowed = narrowSearchUrl(searchUrl, first.doc, settings.filters);
        crawlUrl = narrowed.url;
        narrowedBy = narrowed.applied;
      }
    } catch (err) {
      if (err instanceof AbortedError) throw err;
      console.warn('[AGF] athome 側の絞り込みを省略しました:', err);
    }
  }

  const listings = streamListings({
    baseUrl: crawlUrl,
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
        total: target,
        tallies: tallies()
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

      const cardReasons = evaluate(settings.filters, listing.fields, { presentFieldsOnly: true });
      if (cardReasons.length > 0) {
        excluded++;
        skipped++;
        record(prefilteredResult(listing, cardReasons));
        continue;
      }

      const stored = await getDetail(listing.id);
      let detail: Detail | null = isFresh(stored, startedAt, maxAgeMs) ? (stored ?? null) : null;

      if (detail) {
        cached++;
      } else {
        if (inspected > 0)
          await sleep(paceDelay(settings.requestDelayMs, pacer.cooldownMs), signal);

        inspected++;
        onProgress?.({
          phase: 'detail',
          message:
            target > 0
              ? `合致 ${passed} / ${target}件（${inspected}件目を取得中、キャッシュ ${cached}件）`
              : `合致 ${passed}件（${inspected}件目を取得中、キャッシュ ${cached}件）`,
          current: passed,
          total: target,
          tallies: tallies()
        });

        const fetched = await fetchDetail(listing.url, signal, pacer);
        if (!fetched) {
          failed++;
          record(failedResult(listing));
          continue;
        }

        detail = { id: listing.id, fetchedAt: Date.now(), ...fetched };
        void putDetail(detail);
      }

      const fields = carryParty(listing.fields, detail.fields);
      const reasons = evaluate(settings.filters, fields);
      if (reasons.length === 0) passed++;
      else excluded++;
      record({
        url: listing.url,
        passed: reasons.length === 0,
        reasons,
        name: detail.name,
        price: detail.price,
        area: detail.area,
        location: detail.location,
        traffic: detail.traffic,
        fields
      });
    }
  } catch (err) {
    if (err instanceof AbortedError) report.stoppedBy = 'aborted';
    else if (err instanceof BlockedError) report.stoppedBy = 'blocked';
    else throw err;
  }

  const stoppedBy = resolveStopReason(report, passed, target, inspected, inspectLimit);

  await putSearch({
    searchKey: canonicalSearchKey(crawlUrl),
    searchUrl: crawlUrl,
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
    total: target,
    tallies: tallies()
  });

  return {
    timestamp: Date.now(),
    searchUrl: crawlUrl,
    narrowedBy,
    countBefore,
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
    source: report.source,
    properties: settings.keepExcluded ? properties : properties.filter(p => p.passed)
  };
}
