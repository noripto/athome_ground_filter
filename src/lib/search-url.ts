import { parseAreaSqm, parsePriceMan, parseWalkMinutes } from './numbers';
import type { FilterSettings, NumericRangeState } from './types';

export type ConditionName = 'PRICEFROM' | 'PRICETO' | 'TOCHIMENSEKI' | 'EKITOHO';

export interface ConditionOption {
  code: string;
  label: string;
  value: number | null;
}

export type ConditionOptions = Partial<Record<ConditionName, ConditionOption[]>>;

const READERS: Record<ConditionName, (raw: string) => number | null> = {
  PRICEFROM: parsePriceMan,
  PRICETO: parsePriceMan,
  TOCHIMENSEKI: parseAreaSqm,
  EKITOHO: parseWalkMinutes
};

const PRICE_UNDECIDED = 'kp299';

export function parseConditionOptions(root: ParentNode): ConditionOptions {
  const options: ConditionOptions = {};

  for (const name of Object.keys(READERS) as ConditionName[]) {
    const select = root.querySelector(`select[name="${name}"]`);
    if (!select) continue;

    const read = READERS[name];
    options[name] = [...select.querySelectorAll('option')]
      .map(option => {
        const label = option.textContent?.trim() ?? '';
        return { code: option.getAttribute('value') ?? '', label, value: read(label) };
      })
      .filter(option => option.code !== '');
  }

  return options;
}

export function pickStep(
  options: readonly ConditionOption[],
  want: number,
  bound: 'upper' | 'lower'
): ConditionOption | null {
  const graded = options.filter(
    (option): option is ConditionOption & { value: number } => option.value !== null
  );

  const usable =
    bound === 'upper'
      ? graded.filter(option => option.value >= want)
      : graded.filter(option => option.value <= want);
  if (usable.length === 0) return null;

  return usable.reduce((best, option) =>
    bound === 'upper'
      ? option.value < best.value
        ? option
        : best
      : option.value > best.value
        ? option
        : best
  );
}

function valueOf(options: readonly ConditionOption[], code: string): number | null {
  return options.find(option => option.code === code)?.value ?? null;
}

function currentCode(codes: readonly string[], options: readonly ConditionOption[]): string | null {
  const known = new Set(options.map(option => option.code));
  return codes.find(code => known.has(code)) ?? null;
}

function tighter(current: number | null, next: number, bound: 'upper' | 'lower'): boolean {
  if (current === null) return true;
  return bound === 'upper' ? next < current : next > current;
}

function replace(codes: readonly string[], old: string | null, next: string): string[] {
  if (old === null) return [...codes, next];
  return codes.map(code => (code === old ? next : code));
}

function rangeState(filters: FilterSettings, id: string): NumericRangeState | null {
  const state = filters[id] as NumericRangeState | undefined;
  return state?.enabled ? state : null;
}

export function narrowBasic(
  codes: readonly string[],
  options: ConditionOptions,
  filters: FilterSettings
): { codes: string[]; applied: string[] } {
  const wanted: { name: ConditionName; bound: 'upper' | 'lower'; want: number | null }[] = [
    { name: 'PRICEFROM', bound: 'lower', want: rangeState(filters, 'kakaku')?.min ?? null },
    { name: 'PRICETO', bound: 'upper', want: rangeState(filters, 'kakaku')?.max ?? null },
    { name: 'TOCHIMENSEKI', bound: 'lower', want: rangeState(filters, 'menseki')?.min ?? null },
    { name: 'EKITOHO', bound: 'upper', want: rangeState(filters, 'ekitoho')?.max ?? null }
  ];

  let next = [...codes];
  const applied: string[] = [];
  let cappedPrice = false;

  for (const { name, bound, want } of wanted) {
    const available = options[name];
    if (want === null || !available || available.length === 0) continue;

    const step = pickStep(available, want, bound);
    if (!step) continue;

    const old = currentCode(next, available);
    if (!tighter(old === null ? null : valueOf(available, old), step.value ?? want, bound))
      continue;

    next = replace(next, old, step.code);
    applied.push(`${name}=${step.label}`);
    if (name === 'PRICETO' || name === 'PRICEFROM') cappedPrice = true;
  }

  if (cappedPrice && next.includes(PRICE_UNDECIDED)) {
    next = next.filter(code => code !== PRICE_UNDECIDED);
    applied.push('価格未定を除外');
  }

  return { codes: next, applied };
}

export function readBasic(url: string): string[] {
  const raw = new URL(url).searchParams.get('basic') ?? '';
  return raw.split(',').filter(Boolean);
}

export function writeBasic(url: string, codes: readonly string[]): string {
  const next = new URL(url);
  if (codes.length === 0) next.searchParams.delete('basic');
  else next.searchParams.set('basic', codes.join(','));
  return next.toString();
}

export function narrowSearchUrl(
  url: string,
  root: ParentNode,
  filters: FilterSettings
): { url: string; applied: string[] } {
  const options = parseConditionOptions(root);
  const { codes, applied } = narrowBasic(readBasic(url), options, filters);
  return { url: applied.length === 0 ? url : writeBasic(url, codes), applied };
}
