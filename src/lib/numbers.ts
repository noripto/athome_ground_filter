/**
 * Turning athome's printed figures into numbers.
 *
 * Everything the site prints is prose: 「1億500万円」, 「132.45m²（40.06坪）」,
 * 「JR中央線 三鷹駅 徒歩12分」. Sorting and range filters need those as
 * numbers, and reading them naively goes wrong in ways that are easy to miss —
 * a leading-number scan turns 「1億500万円」 into 1, so a price filter capped
 * at 2000万 lets every property over a hundred million through.
 */

/** 1坪 in m². Used to turn a price and an area into a 万円/坪 figure. */
const SQM_PER_TSUBO = 3.30578;

/** Ranges are printed as 「9,500万円～1億2,000万円」 with any of these dashes. */
const RANGE_SEPARATORS = /[~〜～]/;

function toHalfWidth(raw: string): string {
  return raw.replace(/[０-９．]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** The lower bound of a range, or the whole string when it is a single value. */
function lowerBound(raw: string): string {
  return raw.split(RANGE_SEPARATORS)[0];
}

/**
 * A price in 万円. A range resolves to its lower bound, which is what a price
 * sort compares and what a maximum filter should be measured against.
 * 「応相談」 and anything else without a figure yields null.
 */
export function parsePriceMan(raw: string): number | null {
  const text = toHalfWidth(raw).replace(/[\s,]/g, '');
  const value = lowerBound(text);

  const oku = value.match(/([\d.]+)億/);
  const man = value.match(/([\d.]+)万/);
  if (!oku && !man) {
    // 「980円」 and bare numbers are already in 円, not 万円.
    const yen = value.match(/^([\d.]+)円?$/);
    return yen ? Number.parseFloat(yen[1]) / 10_000 : null;
  }

  const total =
    (oku ? Number.parseFloat(oku[1]) * 10_000 : 0) + (man ? Number.parseFloat(man[1]) : 0);
  return Number.isFinite(total) ? total : null;
}

/**
 * An area in m². Anchored on the unit so 「132.45m²（40.06坪）」 never reports
 * the 坪 figure, which a leading-number scan would do if the order ever
 * flipped.
 */
export function parseAreaSqm(raw: string): number | null {
  const text = toHalfWidth(raw).replace(/[\s,]/g, '');
  const match = lowerBound(text).match(/([\d.]+)\s*(?:m²|m2|㎡)/i);
  if (match) return Number.parseFloat(match[1]);

  const tsubo = lowerBound(text).match(/([\d.]+)\s*坪/);
  return tsubo ? Number.parseFloat(tsubo[1]) * SQM_PER_TSUBO : null;
}

/**
 * The shortest walk to a station, in minutes. A property is usually listed
 * against several lines, and the nearest one is what people sort by. A bus
 * leg is not a walk, so 「バス15分 停歩10分」 counts as nothing. Walks are
 * also given as ranges — 「徒歩25～29分」 — which is why the minutes are not
 * simply the digits before 分.
 */
export function parseWalkMinutes(raw: string): number | null {
  const minutes = [...toHalfWidth(raw).matchAll(/徒歩\s*(\d+)(?:\s*[~〜～]\s*\d+)?\s*分/g)].map(m =>
    Number(m[1])
  );
  return minutes.length > 0 ? Math.min(...minutes) : null;
}

/** 万円/坪, or null when either side of the division is unknown. */
export function unitPriceManPerTsubo(
  priceMan: number | null,
  areaSqm: number | null
): number | null {
  if (priceMan === null || areaSqm === null || areaSqm <= 0) return null;
  return priceMan / (areaSqm / SQM_PER_TSUBO);
}
