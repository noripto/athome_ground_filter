import { buildPageUrl, canonicalSearchKey, expectedPages } from '../src/lib/crawler';
import { isFresh } from '../src/lib/db';
import { favoriteBody, isFavouritable, reconcile, unfavoriteBody } from '../src/lib/favorite';
import {
  narrowBasic,
  pickStep,
  readBasic,
  writeBasic,
  type ConditionOptions
} from '../src/lib/search-url';
import {
  parseAreaSqm,
  parsePriceMan,
  parseWalkMinutes,
  unitPriceManPerTsubo
} from '../src/lib/numbers';
import { applyViewFilter, emptyViewFilter, refilter, sortProperties } from '../src/lib/view';
import { detailIdFromUrl, parseTotalCount, splitFieldPair } from '../src/lib/markup';
import { listingsFromState } from '../src/lib/state';
import {
  describeActiveFilters,
  evaluate,
  findField,
  narrowestRoadWidth
} from '../src/lib/evaluate';
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
import type { Favorite } from '../src/lib/types';

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

const listUrl = 'https://www.athome.co.jp/tochi/chuko/tokyo/list/?PREFECTURE=13';

eq(
  'page 1 keeps the search query',
  buildPageUrl(listUrl, 1),
  'https://www.athome.co.jp/tochi/chuko/tokyo/list/?PREFECTURE=13&limit=50'
);
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
eq('a dash is not kept as a value', '私道負担面積' in (fromState[0]?.fields ?? {}), false);
eq('a page with no state yields nothing', listingsFromState('<html></html>').length, 0);

eq(
  'the escaped form parses too',
  listingsFromState(
    '<script id="serverApp-state" type="application/json">' +
      '{&q;first-view-ITEMS&q;:{&q;bukkenData&q;:{&q;bukkenList&q;:[{&q;bukkenNo&q;:&q;123456789&q;}]}}}' +
      '</script>'
  )[0]?.id,
  '123456789'
);

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
eq(
  'a label that does not split evenly is left alone',
  splitFieldPair('所在地', '東京都/八王子市/長房町'),
  [['所在地', '東京都/八王子市/長房町']]
);

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
    await sleep(5, new AbortController().signal);
    eq('an uncancelled wait resolves', true, true);
  })()
);

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

eq('a small goal still gets a usable budget', inspectLimitFor(5), 200);
eq('the budget is ten times the goal', inspectLimitFor(30), 300);
eq('the budget is capped', inspectLimitFor(500), 1200);
eq('an unbounded run gets the standing ceiling', inspectLimitFor(0), 5000);

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

const collected = [
  { ...property('e', '1,000万円'), fields: { 地目: '宅地' }, passed: true, reasons: [] },
  { ...property('f', '1,000万円'), fields: { 地目: '畑' }, passed: true, reasons: [] }
];
const rejudged = refilter(collected, { chimoku: { enabled: true, values: ['畑'] } });

eq('a property the new conditions accept still passes', rejudged[0].passed, true);
eq('a property the new conditions reject is excluded', rejudged[1].passed, false);
eq('and it says why', rejudged[1].reasons, ['地目: 畑']);
eq('the collected fields are left untouched', rejudged[1].fields, { 地目: '畑' });

eq('keys match partially', findField({ 接道状況: '南 幅員4.5m' }, '接道'), '南 幅員4.5m');
eq('missing keys yield an empty string', findField({ 地目: '宅地' }, '価格'), '');

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

{
  eq('複数の接道は最も狭いものを採る', narrowestRoadWidth('北 幅員4.0m ／ 東 幅員2.7m'), 2.7);
  eq('接道が1本ならその幅', narrowestRoadWidth('南 幅員6m'), 6);
  eq('幅の記載が無ければ null', narrowestRoadWidth('私道'), null);
  eq('空文字も null', narrowestRoadWidth(''), null);
}

{
  const held = (id: string, remote: 'unsent' | 'ok' | 'failed'): Favorite => ({
    id,
    addedAt: 0,
    property: {
      url: `https://www.athome.co.jp/tochi/${id}/`,
      passed: true,
      reasons: [],
      name: '',
      price: '',
      area: '',
      location: '',
      traffic: '',
      fields: {}
    },
    remote,
    remoteNote: ''
  });

  const local = [held('1000000001', 'ok'), held('1000000002', 'ok'), held('1000000003', 'failed')];
  const { toImport, toDrop } = reconcile(local, ['1000000001', '1000000009']);

  eq('athome にだけあるものを取り込む', toImport.join(','), '1000000009');
  eq('athome から消えた★は外す候補になる', toDrop.join(','), '1000000002');

  eq('送信できていない★は候補に入らない', toDrop.includes('1000000003'), false);

  const empty = reconcile(local, []);
  eq('空のリストでも送信済みのものだけが候補', empty.toDrop.join(','), '1000000001,1000000002');
  eq('空のリストなら取り込むものは無い', empty.toImport.length, 0);
}

{
  const price = [
    { code: 'kp001', label: '下限なし', value: null },
    { code: 'kp005', label: '2,000万円', value: 2000 },
    { code: 'kp007', label: '3,000万円', value: 3000 },
    { code: 'kp120', label: '5,000万円', value: 5000 }
  ];
  const area = [
    { code: 'kf001', label: '指定なし', value: null },
    { code: 'kf008', label: '100m²以上', value: 100 },
    { code: 'kf010', label: '150m²以上', value: 150 }
  ];
  const walk = [
    { code: 'ke001', label: '指定なし', value: null },
    { code: 'ke004', label: '10分以内', value: 10 },
    { code: 'ke006', label: '20分以内', value: 20 }
  ];

  eq('上限は取りこぼさない側へ切り上げる', pickStep(price, 2500, 'upper')?.code, 'kp007');
  eq('下限は取りこぼさない側へ切り下げる', pickStep(area, 120, 'lower')?.code, 'kf008');
  eq('段が一致すればその段', pickStep(price, 3000, 'upper')?.code, 'kp007');
  eq('刻みより厳しい上限は一番狭い段に丸める', pickStep(price, 500, 'upper')?.code, 'kp005');
  eq('刻みより緩い下限は諦める', pickStep(area, 10, 'lower'), null);
  eq('全段より緩い上限は諦める', pickStep(price, 90_000, 'upper'), null);
  eq('指定なしの段は候補にしない', pickStep(area, 10, 'lower'), null);

  const options: ConditionOptions = { PRICETO: price, TOCHIMENSEKI: area, EKITOHO: walk };
  const filters = getDefaultSettings().filters;
  filters.kakaku = { enabled: true, min: null, max: 2500 };
  filters.menseki = { enabled: true, min: 120, max: null };
  filters.ekitoho = { enabled: true, min: null, max: 12 };

  const narrowed = narrowBasic(['kp299', 'kp120', 'kp001', 'kf001', 'ke001'], options, filters);
  eq('該当する枠だけ差し替える', narrowed.codes.join(','), 'kp007,kp001,kf008,ke006');
  eq('価格を絞ったら価格未定を外す', narrowed.codes.includes('kp299'), false);

  // athome 側が既に厳しいなら、そちらを残す。緩める方向には決して動かさない。
  const stricter = narrowBasic(['kp005', 'kf010', 'ke004'], options, filters);
  eq('athome 側の厳しい上限は残す', stricter.codes.includes('kp005'), true);
  eq('athome 側の厳しい下限は残す', stricter.codes.includes('kf010'), true);
  eq('athome 側の厳しい駅徒歩は残す', stricter.codes.includes('ke004'), true);
  eq('何も変えないなら applied は空', stricter.applied.length, 0);

  const off = getDefaultSettings().filters;
  eq('無効なフィルターは渡さない', narrowBasic(['kp120'], options, off).applied.length, 0);

  const url = 'https://www.athome.co.jp/tochi/chiba/list/?pref=12&basic=kp120,kp001&q=1';
  eq('basic を読む', readBasic(url).join(','), 'kp120,kp001');
  eq('basic を書き戻しても他のクエリは残る', writeBasic(url, ['kp007']).includes('pref=12'), true);
  eq('basic だけ差し替わる', readBasic(writeBasic(url, ['kp007'])).join(','), 'kp007');
}

await Promise.all(cancelChecks);

console.log(failures ? `${failures} 件失敗しました` : 'すべて成功しました');
process.exit(failures ? 1 : 0);
