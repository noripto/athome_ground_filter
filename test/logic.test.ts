/**
 * Logic-level checks for the crawl/filter core. Run with `pnpm test`.
 * The defaults asserted here are the ones inherited from the prototype:
 * 市街化調整区域 / 畑 / 接道3m以下 を除外、取得件数 30。
 */
import { buildPageUrl, expectedPages, parseTotalCount } from '../src/lib/crawler';
import { describeActiveFilters, evaluate, findField } from '../src/lib/evaluate';
import { getDefaultSettings, LIST_PAGE_SIZE } from '../src/lib/config';
import { inspectLimitFor, resolveStopReason } from '../src/lib/run';
import type { ListCrawlReport } from '../src/lib/crawler';

let failures = 0;

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL ${label}`);
  console.error(`  actual   ${a}`);
  console.error(`  expected ${e}`);
}

// ── Pagination ──────────────────────────────────────────────────────────────
const listUrl = 'https://www.athome.co.jp/tochi/chuko/tokyo/list/?PREFECTURE=13';

eq(
  'page 1 keeps the search query',
  buildPageUrl(listUrl, 1),
  'https://www.athome.co.jp/tochi/chuko/tokyo/list/?PREFECTURE=13&limit=50'
);
// athome answers a bare /list/3/ with a 404 — the number needs the `page`
// prefix. Getting this wrong ended every crawl after its first page.
eq(
  'page 3 appends athome’s pageN segment',
  buildPageUrl(listUrl, 3),
  'https://www.athome.co.jp/tochi/chuko/tokyo/list/page3/?PREFECTURE=13&limit=50'
);
eq(
  'an existing page segment is replaced, not stacked',
  buildPageUrl('https://www.athome.co.jp/tochi/chuko/tokyo/list/page2/', 3),
  'https://www.athome.co.jp/tochi/chuko/tokyo/list/page3/?limit=50'
);
eq(
  'a legacy bare page segment is replaced too',
  buildPageUrl('https://www.athome.co.jp/tochi/chuko/tokyo/list/2/', 3),
  'https://www.athome.co.jp/tochi/chuko/tokyo/list/page3/?limit=50'
);
eq('the page size is overridable', buildPageUrl(listUrl, 1, 30).endsWith('limit=30'), true);

// ── Hit count ───────────────────────────────────────────────────────────────
// The number is split across spans, so it is read by anchoring on the class.
const countHtml =
  '<div class="area-top__property">該当物件数' +
  '<span class="area-top__property--number">7,975</span>' +
  '<span class="area-top__property--other">件</span></div>';

eq('the hit count is read past the intervening tags', parseTotalCount(countHtml), 7975);
eq('a page without the count yields null', parseTotalCount('<div>該当物件数</div>'), null);

eq('the last page covers every hit', expectedPages(7975, LIST_PAGE_SIZE), 160);
eq('a partial last page still counts', expectedPages(51, 50), 2);
eq('no hits means no pages', expectedPages(0, 50), 0);
eq('an unknown count gives no page bound', expectedPages(null, 50), null);

// ── Stop reasons ────────────────────────────────────────────────────────────
// Everything that is not the goal or a cap used to collapse into 'exhausted',
// which told the user to widen a search that had actually failed.
const report = (stoppedBy: ListCrawlReport['stoppedBy']): ListCrawlReport => ({
  pagesCrawled: 3,
  totalCount: 7975,
  stoppedBy
});

eq(
  'meeting the goal outranks how the list ended',
  resolveStopReason(report('http'), 30, 30, 40, 300),
  'target'
);
eq(
  'a cap outranks how the list ended',
  resolveStopReason(report('http'), 5, 30, 300, 300),
  'limit'
);
eq(
  'a broken pager is reported as such',
  resolveStopReason(report('paging'), 5, 30, 40, 300),
  'paging'
);
eq(
  'reading every page completes the run',
  resolveStopReason(report('complete'), 900, 0, 900, 5000),
  'complete'
);
eq(
  'a still-running list defaults to exhausted',
  resolveStopReason(report(null), 5, 30, 40, 300),
  'exhausted'
);

// ── Inspection ceiling ──────────────────────────────────────────────────────
// The requested count is a number of *passing* properties, so the crawl needs a
// separate ceiling on how many detail pages it is willing to open looking for them.
eq('a small goal still gets a usable budget', inspectLimitFor(5), 200);
eq('the budget is ten times the goal', inspectLimitFor(30), 300);
eq('the budget is capped', inspectLimitFor(500), 1200);
eq('an unbounded run gets the standing ceiling', inspectLimitFor(0), 5000);

// ── Field lookup ────────────────────────────────────────────────────────────
eq('keys match partially', findField({ 接道状況: '南 幅員4.5m' }, '接道'), '南 幅員4.5m');
eq('missing keys yield an empty string', findField({ 地目: '宅地' }, '価格'), '');

// ── Defaults inherited from the prototype ───────────────────────────────────
const settings = getDefaultSettings();

eq(
  'three filters are on by default',
  Object.entries(settings.filters)
    .filter(([, state]) => state.enabled)
    .map(([id]) => id),
  ['toshikeikaku', 'chimoku', 'setsudo']
);
eq('default target count', settings.targetCount, 30);
eq('summary of the defaults', describeActiveFilters(settings.filters), [
  '都市計画≠[市街化調整区域]',
  '地目≠[畑]',
  '接道幅（最小）>3m'
]);

// ── Evaluation ──────────────────────────────────────────────────────────────
eq(
  'a clean lot passes',
  evaluate(settings.filters, {
    都市計画: '市街化区域',
    地目: '宅地',
    接道状況: '南側 幅員 5.5m'
  }),
  []
);
eq(
  '市街化調整区域 is excluded',
  evaluate(settings.filters, { 都市計画: '市街化調整区域', 地目: '宅地', 接道状況: '南 5.5m' }),
  ['都市計画: 市街化調整区域']
);
eq(
  'the narrowest frontage decides',
  evaluate(settings.filters, {
    都市計画: '市街化区域',
    地目: '宅地',
    接道状況: '東 幅員2.7m / 南 幅員6m'
  }),
  ['接道幅（最小）: 2.7m ≤ 3m']
);
eq(
  'a frontage with no width stated is not excluded',
  evaluate(settings.filters, { 都市計画: '市街化区域', 地目: '宅地', 接道状況: '公道' }),
  []
);

settings.filters.kakaku = { enabled: true, min: 500, max: 2000 };
eq(
  'a price below the range is excluded',
  evaluate(settings.filters, { 価格: '380万円' }).filter(r => r.startsWith('価格')),
  ['価格: 380万円 < 500']
);
eq(
  'thousands separators are ignored',
  evaluate(settings.filters, { 価格: '1,280万円' }).filter(r => r.startsWith('価格')),
  []
);

settings.filters.suido = { enabled: true, required: 'あり' };
eq(
  'a required value that is absent excludes the lot',
  evaluate(settings.filters, { 価格: '900万円', 上水道: '無' }).filter(r => r.startsWith('上水道')),
  ['上水道: 無（「あり」が必要）']
);

console.log(failures ? `${failures} 件失敗しました` : 'すべて成功しました');
process.exit(failures ? 1 : 0);
