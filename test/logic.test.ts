/**
 * Logic-level checks for the crawl/filter core. Run with `pnpm test`.
 * The defaults asserted here are the ones inherited from the prototype:
 * 市街化調整区域 / 畑 / 接道3m以下 を除外、取得件数 30。
 */
import { buildPageUrl, expectedPages } from '../src/lib/crawler';
import { detailIdFromUrl, parseTotalCount, splitFieldPair } from '../src/lib/markup';
import { describeActiveFilters, evaluate, findField } from '../src/lib/evaluate';
import { getDefaultSettings, LIST_PAGE_SIZE } from '../src/lib/config';
import { inspectLimitFor, resolveStopReason } from '../src/lib/run';
import {
  backoffDelay,
  isChallengeHtml,
  newPacer,
  paceDelay,
  policyForStatus,
  retryAfterMs
} from '../src/lib/fetcher';
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
  stoppedBy,
  usedLinkFallback: false
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

// ── Results cards ───────────────────────────────────────────────────────────
// What a card gives up is what a detail page never has to be opened for.
eq(
  'a property id is read out of its URL',
  detailIdFromUrl('https://www.athome.co.jp/tochi/3918978901/?DOWN=1'),
  '3918978901'
);
eq(
  'an area segment does not hide the id',
  detailIdFromUrl('https://www.athome.co.jp/tochi/tokyo/3918978901/'),
  '3918978901'
);
eq(
  'a list URL holds no property id',
  detailIdFromUrl('https://www.athome.co.jp/tochi/tokyo/list/'),
  null
);

eq('a paired label splits into its two fields', splitFieldPair('建ぺい率/容積率', '40%/80%'), [
  ['建ぺい率', '40%'],
  ['容積率', '80%']
]);
eq('an ordinary label is left alone', splitFieldPair('土地面積', '131.30m²～208.08m²'), [
  ['土地面積', '131.30m²～208.08m²']
]);
// Without the count check, 「所在地」with a slash in it would be torn in half.
eq(
  'a label that does not split evenly is left alone',
  splitFieldPair('所在地', '東京都/八王子市/長房町'),
  [['所在地', '東京都/八王子市/長房町']]
);

// ── Pre-filtering on the card ───────────────────────────────────────────────
// A card carries a handful of fields. A filter on any of the others knows
// nothing yet, and must not read that silence as a failure.
const cardFields = { 土地面積: '95.00m²', 所在地: '東京都八王子市', 建ぺい率: '40%' };
const strict = getDefaultSettings().filters;

eq(
  'a filter whose field the card lacks is held back',
  evaluate(strict, cardFields, { presentFieldsOnly: true }),
  []
);
eq(
  'the same filter fails once the detail page is missing the field',
  evaluate({ ...strict, suido: { enabled: true, required: 'あり' } }, cardFields).length > 0,
  true
);
eq(
  'a filter the card can answer still rules the property out',
  evaluate({ ...strict, menseki: { enabled: true, min: 100, max: null } }, cardFields, {
    presentFieldsOnly: true
  }),
  ['土地面積: 95m² < 100']
);

// ── Bot check ───────────────────────────────────────────────────────────────
// athome serves its challenge with a 200, so nothing but the body gives it away.
eq(
  'the interstitial is recognised',
  isChallengeHtml(
    '<title>【アットホーム】認証中</title><script>window.reeseSkipExpirationCheck</script>'
  ),
  true
);
eq(
  'a page with results is never a challenge',
  isChallengeHtml('<div class="card-box-inner">…</div><script>onProtectionInitialized</script>'),
  false
);
eq(
  'an ordinary page is not a challenge',
  isChallengeHtml('<div class="property-price">1,280万円</div>'),
  false
);

// ── Retry policy ────────────────────────────────────────────────────────────
eq('throttling is retried patiently', policyForStatus(429)?.attempts, 5);
eq('a gateway error is retried', policyForStatus(502)?.attempts, 3);
eq('a forbidden response waits longest', policyForStatus(403)?.baseMs, 10_000);
eq('an ordinary client error is final', policyForStatus(400), null);

const policy = { baseMs: 1000, maxMs: 8000, attempts: 5 };
eq(
  'the first wait is the base wait',
  backoffDelay(0, policy, () => 0.5),
  1000
);
eq(
  'each attempt doubles the wait',
  backoffDelay(2, policy, () => 0.5),
  4000
);
eq(
  'the wait is capped',
  backoffDelay(9, policy, () => 0.5),
  8000
);
eq(
  'jitter reaches down a quarter',
  backoffDelay(0, policy, () => 0),
  750
);
eq(
  'jitter reaches up a quarter',
  backoffDelay(0, policy, () => 1),
  1250
);

eq('Retry-After in seconds', retryAfterMs('30'), 30_000);
eq(
  'Retry-After as a date',
  retryAfterMs('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')),
  10_000
);
eq(
  'a date already past waits no time',
  retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:29:00 GMT')),
  0
);
eq('no header means no stated wait', retryAfterMs(null), null);
eq('unparseable headers are ignored', retryAfterMs('soon'), null);

// ── Pacing ──────────────────────────────────────────────────────────────────
// A challenge slows the whole run down, not just the request that tripped it.
const pacer = newPacer();
eq('a fresh run has no penalty', pacer.cooldownMs, 0);
pacer.penalise();
eq('a challenge widens the gap', pacer.cooldownMs, 1500);
pacer.penalise();
eq('challenges accumulate', pacer.cooldownMs, 3000);
for (let i = 0; i < 19; i++) pacer.reward();
eq('a short clean streak is not enough to recover', pacer.cooldownMs, 3000);
pacer.reward();
eq('a long clean streak halves the penalty', pacer.cooldownMs, 1500);
for (let i = 0; i < 20; i++) pacer.reward();
eq('the penalty eventually clears entirely', pacer.cooldownMs, 0);

eq(
  'the penalty is added to the configured pace',
  paceDelay(900, 1500, () => 0.5),
  2400
);
eq(
  'pacing jitters down three tenths',
  paceDelay(1000, 0, () => 0),
  700
);
eq(
  'pacing jitters up three tenths',
  paceDelay(1000, 0, () => 1),
  1300
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
