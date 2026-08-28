import { AbortedError, fetchDetail, sleep, streamDetailLinks } from './crawler';
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
  seedLinks?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: RunProgress) => void;
}

/**
 * Ceiling on detail pages opened in one run, so that a filter set nothing can
 * satisfy stops instead of walking the entire search.
 */
export function inspectLimitFor(target: number): number {
  return Math.min(1200, Math.max(200, target * 10));
}

function failedResult(url: string): PropertyResult {
  return {
    url,
    passed: false,
    reasons: ['詳細ページの取得に失敗しました'],
    price: '',
    area: '',
    location: '',
    traffic: '',
    title: '',
    fields: {}
  };
}

/**
 * Walks the search results until `settings.targetCount` properties have *passed*
 * the filters — excluded ones do not count towards the goal — and reports
 * progress as it goes. Throws `AbortedError` if `signal` fires.
 */
export async function runFilter(options: RunOptions): Promise<ResultSet> {
  const { searchUrl, settings, seedLinks, signal, onProgress } = options;
  const target = settings.targetCount;
  const inspectLimit = inspectLimitFor(target);

  const properties: PropertyResult[] = [];
  let pagesCrawled = 0;
  let inspected = 0;
  let passed = 0;
  let excluded = 0;
  let failed = 0;

  const links = streamDetailLinks({
    baseUrl: searchUrl,
    delayMs: settings.requestDelayMs,
    signal,
    seedLinks,
    onPage: (pages, linksSeen) => {
      pagesCrawled = pages;
      onProgress?.({
        phase: 'list',
        message: `リスト ${pages} ページ目（候補 ${linksSeen}件）`,
        current: passed,
        total: target
      });
    }
  });

  for await (const url of links) {
    if (signal?.aborted) throw new AbortedError();
    if (passed >= target || inspected >= inspectLimit) break;
    if (inspected > 0) await sleep(settings.requestDelayMs);

    inspected++;
    onProgress?.({
      phase: 'detail',
      message: `合致 ${passed} / ${target}件（${inspected}件目を確認中）`,
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

  const stoppedBy: StopReason =
    passed >= target ? 'target' : inspected >= inspectLimit ? 'limit' : 'exhausted';

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
    inspected,
    passed,
    excluded,
    failed,
    pagesCrawled,
    stoppedBy,
    inspectLimit,
    activeFilters: describeActiveFilters(settings.filters),
    properties: settings.keepExcluded ? properties : properties.filter(p => p.passed)
  };
}
