const SQM_PER_TSUBO = 3.30578;

const RANGE_SEPARATORS = /[~〜～]/;

function toHalfWidth(raw: string): string {
  return raw.replace(/[０-９．]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function lowerBound(raw: string): string {
  return raw.split(RANGE_SEPARATORS)[0];
}

export function parsePriceMan(raw: string): number | null {
  const text = toHalfWidth(raw).replace(/[\s,]/g, '');
  const value = lowerBound(text);

  const oku = value.match(/([\d.]+)億/);
  const man = value.match(/([\d.]+)万/);
  if (!oku && !man) {
    const yen = value.match(/^([\d.]+)円?$/);
    return yen ? Number.parseFloat(yen[1]) / 10_000 : null;
  }

  const total =
    (oku ? Number.parseFloat(oku[1]) * 10_000 : 0) + (man ? Number.parseFloat(man[1]) : 0);
  return Number.isFinite(total) ? total : null;
}

export function parseAreaSqm(raw: string): number | null {
  const text = toHalfWidth(raw).replace(/[\s,]/g, '');
  const match = lowerBound(text).match(/([\d.]+)\s*(?:m²|m2|㎡)/i);
  if (match) return Number.parseFloat(match[1]);

  const tsubo = lowerBound(text).match(/([\d.]+)\s*坪/);
  return tsubo ? Number.parseFloat(tsubo[1]) * SQM_PER_TSUBO : null;
}

export function parseWalkMinutes(raw: string): number | null {
  const minutes = [...toHalfWidth(raw).matchAll(/徒歩\s*(\d+)(?:\s*[~〜～]\s*\d+)?\s*分/g)].map(m =>
    Number(m[1])
  );
  return minutes.length > 0 ? Math.min(...minutes) : null;
}

export function unitPriceManPerTsubo(
  priceMan: number | null,
  areaSqm: number | null
): number | null {
  if (priceMan === null || areaSqm === null || areaSqm <= 0) return null;
  return priceMan / (areaSqm / SQM_PER_TSUBO);
}
