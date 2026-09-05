/**
 * Logic-level checks for the crawl/filter core. Run with `pnpm test`.
 * The defaults asserted here are the ones inherited from the prototype:
 * 市街化調整区域 / 畑 / 接道3m以下 を除外、取得件数 30。
 */
import { buildPageUrl, canonicalSearchKey, expectedPages } from '../src/lib/crawler';
import { isFresh } from '../src/lib/db';
import { favoriteBody, isFavouritable, unfavoriteBody } from '../src/lib/favorite';
import {
  parseAreaSqm,
  parsePriceMan,
  parseWalkMinutes,
  unitPriceManPerTsubo
} from '../src/lib/numbers';
import { applyViewFilter, emptyViewFilter, refilter, sortProperties } from '../src/lib/view';
import { detailIdFromUrl, parseTotalCount, splitFieldPair } from '../src/lib/markup';
import { listingsFromState } from '../src/lib/state';
import { describeActiveFilters, evaluate, findField } from '../src/lib/evaluate';
import { getDefaultSettings, LIST_PAGE_SIZE } from '../src/lib/config';
import { inspectLimitFor, resolveStopReason } from '../src/lib/run';
import {
  backoffDelay,
  isChallengeHtml,
  newPacer,
  paceDelay,
  policyForStatus,
  retryAfterMs,
  sleep
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
  source: null
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

// ── Search identity ─────────────────────────────────────────────────────────
// Page five of a search has to key the same as page one, or a second run would
// remember nothing and pay full price all over again.
eq(
  'the page segment does not change a search’s identity',
  canonicalSearchKey('https://www.athome.co.jp/tochi/tokyo/list/page5/?PREFECTURE=13&limit=50'),
  'https://www.athome.co.jp/tochi/tokyo/list/?PREFECTURE=13'
);
eq(
  'athome’s own tracking parameters are dropped',
  canonicalSearchKey(
    'https://www.athome.co.jp/tochi/tokyo/list/?sref=list_simple&DOWN=1&BKLISTID=001LPC&PREFECTURE=13'
  ),
  'https://www.athome.co.jp/tochi/tokyo/list/?PREFECTURE=13'
);
eq(
  'the order the conditions were written in does not matter',
  canonicalSearchKey('https://www.athome.co.jp/tochi/tokyo/list/?b=2&a=1'),
  canonicalSearchKey('https://www.athome.co.jp/tochi/tokyo/list/?a=1&b=2')
);
eq(
  'different conditions are different searches',
  canonicalSearchKey('https://www.athome.co.jp/tochi/tokyo/list/?PREFECTURE=13') ===
    canonicalSearchKey('https://www.athome.co.jp/tochi/tokyo/list/?PREFECTURE=14'),
  false
);

// ── Cache freshness ─────────────────────────────────────────────────────────
const day = 24 * 60 * 60 * 1000;
const detail = (fetchedAt: number) => ({
  id: '1',
  fields: {},
  name: '',
  price: '',
  area: '',
  location: '',
  traffic: '',
  fetchedAt
});

eq('a detail read today is reused', isFresh(detail(1000 * day), 1000 * day + day, 7 * day), true);
eq(
  'a detail past its age is read again',
  isFresh(detail(1000 * day), 1000 * day + 8 * day, 7 * day),
  false
);
eq('a detail never read is not fresh', isFresh(undefined, 1000 * day, 7 * day), false);
eq('a zero age reads everything again', isFresh(detail(1000 * day), 1000 * day + 1, 0), false);

// ── athome's own data ───────────────────────────────────────────────────────
// One real record, trimmed to the keys the parser reads. It carries 土地権利,
// 建ぺい率 and 容積率, none of which the rendered card shows — so these filters
// can be answered without opening a detail page at all.
const stateFixture =
  '<script id="serverApp-state" type="application/json">' +
  '{"first-view-ITEMS":{"bukkenData":{"bukkenList":[{"bukkenNo":"3918978901",' +
  '"title":"プラスパータウン長房","kakaku":{"priceText":[{"priceOku":"","priceMan":"1,650",' +
  '"unitText":"円"},{"priceOku":"","priceMan":"2,920","unitText":"円"}],"bufferText":"～",' +
  '"otherUnitText":"","noPlan":""},"landareaFromTo":"131.30m²～208.08m²",' +
  '"location":"八王子市 長房町798","access":[{"accessText":"ＪＲ中央線 「西八王子」駅 徒歩25～29分",' +
  '"accessEkiToho":"25分"},{"accessText":""}],"right":"所有権",' +
  '"buildingCoverageRatio":"40%","floorAreaRatio":"80%","priroad":"-",' +
  '"propertyDetailData":{"syumoku":"建築条件付き土地"},"urlLong":"/ahto/hcj"}]}}}' +
  '</script>';

const fromState = listingsFromState(stateFixture);

eq('the transfer state yields its properties', fromState.length, 1);
eq('the property id comes from bukkenNo', fromState[0]?.id, '3918978901');
// urlLong is the agency's page, so the URL has to be built from the id.
eq(
  'the detail URL is built from the id, not urlLong',
  fromState[0]?.url,
  'https://www.athome.co.jp/tochi/3918978901/'
);
eq('the split price is put back together', fromState[0]?.price, '1,650万円～2,920万円');
eq(
  'fields the card never shows come through',
  [
    fromState[0]?.fields['土地権利'],
    fromState[0]?.fields['建ぺい率'],
    fromState[0]?.fields['容積率']
  ],
  ['所有権', '40%', '80%']
);
// A dash is how athome writes 「none」, and storing it would make a filter read
// an absent value as a present one.
eq('a dash is not kept as a value', '私道負担面積' in (fromState[0]?.fields ?? {}), false);
eq('a page with no state yields nothing', listingsFromState('<html></html>').length, 0);

// The escaped form Angular sometimes inlines has to parse the same way.
eq(
  'the escaped form parses too',
  listingsFromState(
    '<script id="serverApp-state" type="application/json">' +
      '{&q;first-view-ITEMS&q;:{&q;bukkenData&q;:{&q;bukkenList&q;:[{&q;bukkenNo&q;:&q;123456789&q;}]}}}' +
      '</script>'
  )[0]?.id,
  '123456789'
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
const cardFields = {
  土地面積: '95.00m²',
  所在地: '東京都八王子市',
  建ぺい率: '40%',
  価格: '3,200万円',
  交通: 'ＪＲ中央線 「西八王子」駅 徒歩25～29分'
};
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
// The card prints its price outside the label table, so it has to be put into
// the field map by hand — without it every property over budget was still
// getting its detail page opened.
eq(
  'the card answers the price filter, so no detail page is opened',
  evaluate({ ...strict, kakaku: { enabled: true, min: null, max: 2000 } }, cardFields, {
    presentFieldsOnly: true
  }),
  ['価格: 3200万円 > 2000']
);
eq(
  'the card answers the walk filter too',
  evaluate({ ...strict, ekitoho: { enabled: true, min: null, max: 15 } }, cardFields, {
    presentFieldsOnly: true
  }),
  ['駅徒歩: 25分 > 15']
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

// ── Cancelling mid-wait ─────────────────────────────────────────────────────
// A backoff waits up to two minutes. A cancellation that has to sit through
// that is not a cancellation, so the wait itself has to give up.
const cancelChecks: Promise<void>[] = [];

cancelChecks.push(
  (async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    try {
      await waiting;
      eq('an aborted wait rejects', 'resolved', 'AbortedError');
    } catch (err) {
      eq('an aborted wait rejects', (err as Error).name, 'AbortedError');
      eq('an aborted wait gives up at once', Date.now() - started < 1000, true);
    }
  })()
);

cancelChecks.push(
  (async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await sleep(60_000, controller.signal);
      eq('a wait that starts cancelled never waits', 'resolved', 'AbortedError');
    } catch (err) {
      eq('a wait that starts cancelled never waits', (err as Error).name, 'AbortedError');
    }
  })()
);

cancelChecks.push(
  (async () => {
    // An ordinary wait must still resolve, and must not leave the process
    // holding an abort listener on a signal it no longer cares about.
    await sleep(5, new AbortController().signal);
    eq('an uncancelled wait resolves', true, true);
  })()
);

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

// ── Reading athome's figures ────────────────────────────────────────────────
// Everything the site prints is prose, and reading it naively goes wrong
// quietly: a leading-number scan turns 「1億500万円」 into 1.
eq('a plain price', parsePriceMan('1,280万円'), 1280);
eq('hundreds of millions', parsePriceMan('1億500万円'), 10500);
eq('a round 億', parsePriceMan('1億円'), 10000);
eq('a range takes its lower bound', parsePriceMan('9,500万円～1億2,000万円'), 9500);
eq('a full-width range separator', parsePriceMan('1,650万円〜2,920万円'), 1650);
eq('a price on application is unknown', parsePriceMan('応相談'), null);
eq('an empty price is unknown', parsePriceMan(''), null);

eq('an area in m²', parseAreaSqm('132.45m²（40.06坪）'), 132.45);
eq('an area range takes its lower bound', parseAreaSqm('61.24m²～71.37m²'), 61.24);
eq('a dash is not an area', parseAreaSqm('―'), null);
eq('an area given only in 坪 converts', Math.round(parseAreaSqm('10坪') ?? 0), 33);

eq(
  'the nearest station wins',
  parseWalkMinutes('JR中央線 三鷹駅 徒歩12分 ／ 京王線 調布駅 徒歩8分'),
  8
);
eq('a bus leg is not a walk', parseWalkMinutes('バス15分 停歩3分 徒歩5分'), 5);
// athome writes walks as ranges too, which the digits-before-分 reading missed.
eq(
  'a walk given as a range takes its lower bound',
  parseWalkMinutes('ＪＲ中央線 「西八王子」駅 徒歩25～29分'),
  25
);
eq(
  'a bus-only listing has no walk at all',
  parseWalkMinutes('ＪＲ中央線 「高尾」駅 バス18分 「長房センター」 停歩10～15分'),
  null
);
eq('no walk stated is unknown', parseWalkMinutes('車6km'), null);

eq(
  'a unit price in 万円/坪',
  Math.round((unitPriceManPerTsubo(1280, 132.45) ?? 0) * 100) / 100,
  31.95
);
eq('an unknown price yields no unit price', unitPriceManPerTsubo(null, 132.45), null);
eq('an unknown area yields no unit price', unitPriceManPerTsubo(1280, null), null);

// The regression this fixes: a maximum of 2000万 used to let 1億500万 through,
// because the value was read as「1」.
eq(
  'a price over 一億 is excluded by a 2000万 maximum',
  evaluate({ kakaku: { enabled: true, min: null, max: 2000 } }, { 価格: '1億500万円' }).length,
  1
);
eq(
  'a price under the maximum still passes',
  evaluate({ kakaku: { enabled: true, min: null, max: 2000 } }, { 価格: '1,280万円' }),
  []
);

// ── Sorting ─────────────────────────────────────────────────────────────────
// Sorting by cheapest must not open with the ones whose price is unknown.
const property = (name: string, price: string, area = '', traffic = '') => ({
  url: `https://www.athome.co.jp/tochi/${name}/`,
  passed: true,
  reasons: [],
  name,
  price,
  area,
  location: '東京都八王子市',
  traffic,
  fields: {}
});

const listing = [
  property('a', '2,000万円', '100m²'),
  property('b', '応相談'),
  property('c', '1億円', '400m²'),
  property('d', '800万円', '50m²')
];

eq(
  'cheapest first, unknown prices last',
  sortProperties(listing, { key: 'price', label: '', ascending: true }).map(p => p.name),
  ['d', 'a', 'c', 'b']
);
eq(
  'dearest first, unknown prices still last',
  sortProperties(listing, { key: 'price', label: '', ascending: false }).map(p => p.name),
  ['c', 'a', 'd', 'b']
);
eq(
  'the order found is left alone',
  sortProperties(listing, { key: 'found', label: '', ascending: true }).map(p => p.name),
  ['a', 'b', 'c', 'd']
);
eq(
  'largest area first',
  sortProperties(listing, { key: 'area', label: '', ascending: false }).map(p => p.name),
  ['c', 'a', 'd', 'b']
);

// ── Narrowing what is already in hand ───────────────────────────────────────
eq(
  'a keyword matches the address',
  applyViewFilter(listing, { ...emptyViewFilter(), keyword: '八王子' }).length,
  4
);
eq(
  'a keyword that matches nothing narrows to nothing',
  applyViewFilter(listing, { ...emptyViewFilter(), keyword: '横浜' }).length,
  0
);
eq(
  'a price ceiling drops the ones above it and the unreadable ones',
  applyViewFilter(listing, { ...emptyViewFilter(), maxPriceMan: 2000 }).map(p => p.name),
  ['a', 'd']
);
eq('no conditions means no narrowing', applyViewFilter(listing, emptyViewFilter()).length, 4);

// ── Re-judging without crawling again ───────────────────────────────────────
const collected = [
  { ...property('e', '1,000万円'), fields: { 地目: '宅地' }, passed: true, reasons: [] },
  { ...property('f', '1,000万円'), fields: { 地目: '畑' }, passed: true, reasons: [] }
];
const rejudged = refilter(collected, { chimoku: { enabled: true, values: ['畑'] } });

eq('a property the new conditions accept still passes', rejudged[0].passed, true);
eq('a property the new conditions reject is excluded', rejudged[1].passed, false);
eq('and it says why', rejudged[1].reasons, ['地目: 畑']);
eq('the collected fields are left untouched', rejudged[1].fields, { 地目: '畑' });

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

// The cancellation checks are the only asynchronous ones, so they have to
// settle before the tally is read.
// ── athome のお気に入り登録 ──────────────────────────────────────────────
{
  const body = new URLSearchParams(favoriteBody('3923866001'));

  eq('物件番号がそのまま BUKKEN になる', body.get('BUKKEN'), '3923866001');
  eq('BUKKEN_ART は番号と ART の連結', body.get('BUKKEN_ART'), '3923866001_14');
  eq('土地の ITEM は固定', body.get('ITEM'), 'ks');
  eq('土地の ART は固定', body.get('ART'), '14');
  eq('SITECD は本体サイト', body.get('SITECD'), '00000');
  eq(
    'athome 自身の並び順で送る',
    favoriteBody('3923866001'),
    'SITECD=00000&ITEM=ks&ART=14&BUKKEN=3923866001&BUKKEN_ART=3923866001_14&sref=list_simple'
  );

  eq('物件番号でないものは弾く', isFavouritable('ks14392386'), false);
  eq('空文字も弾く', isFavouritable(''), false);
  eq('数字の物件番号は通る', isFavouritable('3923866001'), true);

  const del = new URLSearchParams(unfavoriteBody('3923328901'));
  eq('解除も同じ物件番号で引く', del.get('BUKKEN'), '3923328901');
  eq('ITEMART は ITEM と ART の連結', del.get('ITEMART'), 'ks14');
  eq('削除フラグが立つ', del.get('DELFLG'), '1');
  eq(
    '解除も athome 自身の並び順で送る',
    unfavoriteBody('3923328901'),
    'DELFLG=1&TAB_CODE=2030&SORT=32&BUKKEN=3923328901&ITEMART=ks14'
  );

  let threw = false;
  try {
    favoriteBody('nonsense');
  } catch {
    threw = true;
  }
  eq('組み立てられない番号は投げる前に落ちる', threw, true);
}

await Promise.all(cancelChecks);

console.log(failures ? `${failures} 件失敗しました` : 'すべて成功しました');
process.exit(failures ? 1 : 0);
