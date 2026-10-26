import type { ResultSet } from './types';

const SAMPLE_URLS = 3;

export const siteChangeSuspected = (results: ResultSet): boolean =>
  (results.missingParts?.length ?? 0) > 0 ||
  results.source === 'cards' ||
  results.source === 'links' ||
  results.stoppedBy === 'paging';

export const reportWorthy = (results: ResultSet): boolean =>
  siteChangeSuspected(results) || results.stoppedBy === 'http' || results.stoppedBy === 'blocked';

export const buildReport = (results: ResultSet, version: string, userAgent: string): string =>
  [
    '[AtHome 土地フィルター] 報告',
    `日時: ${new Date(results.timestamp).toLocaleString('ja-JP')}`,
    `拡張バージョン: ${version}`,
    `UA: ${userAgent}`,
    `検索URL: ${results.searchUrl}`,
    `停止理由: ${results.stoppedBy}`,
    `一覧の取得元: ${results.source ?? '不明'}`,
    `取れなかった項目: ${results.missingParts?.join(', ') || 'なし'}`,
    `件数: 確認 ${results.inspected} / 合致 ${results.passed} / 除外 ${results.excluded} / 失敗 ${results.failed} / 総件数 ${results.totalCount ?? '不明'} / ${results.pagesCrawled}ページ`,
    `適用条件: ${results.activeFilters.join(' ／ ') || 'なし'}`,
    '物件URL（例）:',
    ...results.properties.slice(0, SAMPLE_URLS).map(property => `- ${property.url}`)
  ].join('\n');
