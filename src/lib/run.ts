import { AbortedError, collectDetailLinks, fetchDetail, sleep } from './crawler';
import { describeActiveFilters, evaluate } from './evaluate';
import type { PropertyResult, ResultSet, Settings } from './types';

export interface RunProgress {
  phase: 'list' | 'detail' | 'done';
  message: string;
  current: number;
  total: number;
}

export interface RunOptions {
  searchUrl: string;
  settings: Settings;
  seedLinks?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: RunProgress) => void;
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
 * Crawls list pages, fetches each detail page and applies the filters,
 * reporting progress as it goes. Throws `AbortedError` if `signal` fires.
 */
export async function runFilter(options: RunOptions): Promise<ResultSet> {
  const { searchUrl, settings, seedLinks, signal, onProgress } = options;
  const target = settings.targetCount;

  const { links, pagesCrawled } = await collectDetailLinks({
    baseUrl: searchUrl,
    target,
    delayMs: settings.requestDelayMs,
    signal,
    seedLinks,
    onProgress: (page, collected) =>
      onProgress?.({
        phase: 'list',
        message: `リスト ${page} ページ目 — ${collected} / ${target} 件`,
        current: collected,
        total: target
      })
  });

  const properties: PropertyResult[] = [];
  let passed = 0;
  let excluded = 0;
  let failed = 0;

  for (const [index, url] of links.entries()) {
    if (signal?.aborted) throw new AbortedError();

    onProgress?.({
      phase: 'detail',
      message: `詳細取得中 ${index + 1} / ${links.length}`,
      current: index + 1,
      total: links.length
    });

    const detail = await fetchDetail(url, signal);
    if (!detail) {
      failed++;
      properties.push(failedResult(url));
    } else {
      const reasons = evaluate(settings.filters, detail.fields);
      if (reasons.length === 0) passed++;
      else excluded++;
      properties.push({ url, passed: reasons.length === 0, reasons, ...detail });
    }

    if (index < links.length - 1) await sleep(settings.requestDelayMs);
  }

  onProgress?.({
    phase: 'done',
    message: '完了',
    current: links.length,
    total: links.length
  });

  return {
    timestamp: Date.now(),
    searchUrl,
    total: links.length,
    passed,
    excluded,
    failed,
    requested: target,
    pagesCrawled,
    activeFilters: describeActiveFilters(settings.filters),
    properties: settings.keepExcluded ? properties : properties.filter(p => p.passed)
  };
}
