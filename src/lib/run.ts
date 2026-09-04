import { MAX_DETAIL_FETCHES } from './config';
import {
  AbortedError,
  fetchDetail,
  newListCrawlReport,
  sleep,
  streamDetailLinks,
  type ListCrawlReport
} from './crawler';
import { describeActiveFilters, evaluate } from './evaluate';
import type { PropertyResult, ResultSet, Settings, StopReason } from './types';

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

function failedResult(url: string): PropertyResult {
  return {
    url,
    passed: false,
    reasons: ['詳細ページの取得に失敗しました'],
    name: '',
    price: '',
    area: '',
    location: '',
    traffic: '',
    fields: {}
  };
}

/**
 * Walks the search results until `settings.targetCount` properties have *passed*
 * the filters — excluded ones do not count towards the goal — and reports
 * progress as it goes. Throws `AbortedError` if `signal` fires.
 */
export async function runFilter(options: RunOptions): Promise<ResultSet> {
  const { searchUrl, settings, signal, onProgress } = options;
  const target = settings.targetCount;
  const inspectLimit = inspectLimitFor(target);

  const properties: PropertyResult[] = [];
  const report = newListCrawlReport();
  let inspected = 0;
  let passed = 0;
  let excluded = 0;
  let failed = 0;

  const links = streamDetailLinks({
    baseUrl: searchUrl,
    delayMs: settings.requestDelayMs,
    signal,
    report,
    onPage: (progress, linksSeen) => {
      const of = progress.totalCount === null ? '' : ` / 全 ${progress.totalCount}件`;
      onProgress?.({
        phase: 'list',
        message: `リスト ${progress.pagesCrawled} ページ目（候補 ${linksSeen}件${of}）`,
        current: passed,
        total: target
      });
    }
  });

  for await (const url of links) {
    if (signal?.aborted) throw new AbortedError();
    if (target > 0 && passed >= target) break;
    if (inspected >= inspectLimit) break;
    if (inspected > 0) await sleep(settings.requestDelayMs);

    inspected++;
    onProgress?.({
      phase: 'detail',
      message:
        target > 0
          ? `合致 ${passed} / ${target}件（${inspected}件目を確認中）`
          : `合致 ${passed}件（${inspected}件目を確認中）`,
      current: passed,
      total: target
    });

    const detail = await fetchDetail(url, signal);
    if (!detail) {
      failed++;
      properties.push(failedResult(url));
      continue;
    }

    const reasons = evaluate(settings.filters, detail.fields);
    if (reasons.length === 0) passed++;
    else excluded++;
    properties.push({ url, passed: reasons.length === 0, reasons, ...detail });
  }

  const stoppedBy = resolveStopReason(report, passed, target, inspected, inspectLimit);

  onProgress?.({
    phase: 'done',
    message: `完了 — 合致 ${passed}件（${inspected}件を確認）`,
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
    pagesCrawled: report.pagesCrawled,
    stoppedBy,
    inspectLimit,
    activeFilters: describeActiveFilters(settings.filters),
    properties: settings.keepExcluded ? properties : properties.filter(p => p.passed)
  };
}
