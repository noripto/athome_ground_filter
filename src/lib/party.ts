import type { ExcludeTextState, FilterSettings, PropertyResult } from './types';

export const PARTY_FIELD = '問い合わせ先';
export const PARTY_PAGE_FIELD = '会社ページ';
export const UNKNOWN_PARTY = '問い合わせ先不明';
export const PARTY_FILTER_ID = 'toiawase';

const ATHOME_ORIGIN = 'https://www.athome.co.jp';

const collator = new Intl.Collator('ja');

export const LISTED_COMPANY_FIELD = '掲載不動産会社';

export const PARTY_FALLBACK_KEYS = [
  LISTED_COMPANY_FIELD,
  '取扱不動産会社',
  '取扱店舗',
  '取扱会社',
  '取扱店'
] as const;

export function partyOf(fields: Record<string, string>): string {
  const direct = fields[PARTY_FIELD];
  if (direct) return direct;
  for (const key of PARTY_FALLBACK_KEYS) {
    if (fields[key]) return fields[key];
  }
  return '';
}

export function withParty(fields: Record<string, string>): Record<string, string> {
  if (fields[PARTY_FIELD]) return fields;
  const found = partyOf(fields);
  return found ? { ...fields, [PARTY_FIELD]: found } : fields;
}

export function partyPageOf(fields: Record<string, string>): string {
  return fields[PARTY_PAGE_FIELD] ?? '';
}

export function partyPageUrl(raw: string): string {
  if (!raw) return '';
  try {
    return new URL(raw, ATHOME_ORIGIN).href;
  } catch {
    return '';
  }
}

export function partyLabel(property: PropertyResult): string {
  return partyOf(property.fields) || UNKNOWN_PARTY;
}

export function carryParty(
  from: Record<string, string>,
  onto: Record<string, string>
): Record<string, string> {
  const merged = { ...onto };

  if (!merged[PARTY_FIELD] && from[PARTY_FIELD]) {
    merged[PARTY_FIELD] = from[PARTY_FIELD];
    if (from[PARTY_PAGE_FIELD]) merged[PARTY_PAGE_FIELD] = from[PARTY_PAGE_FIELD];
  } else if (!merged[PARTY_PAGE_FIELD] && from[PARTY_PAGE_FIELD]) {
    merged[PARTY_PAGE_FIELD] = from[PARTY_PAGE_FIELD];
  }

  return withParty(merged);
}

export function compareParty(a: PropertyResult, b: PropertyResult): number {
  const left = partyOf(a.fields);
  const right = partyOf(b.fields);
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return collator.compare(left, right);
}

export interface PartyGroup {
  label: string;
  page: string;
  items: PropertyResult[];
}

export function groupByParty(properties: readonly PropertyResult[]): PartyGroup[] {
  const groups = new Map<string, PartyGroup>();

  for (const property of properties) {
    const label = partyLabel(property);
    const group = groups.get(label);
    if (group) {
      group.items.push(property);
      if (!group.page) group.page = partyPageOf(property.fields);
    } else {
      groups.set(label, { label, page: partyPageOf(property.fields), items: [property] });
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.label === UNKNOWN_PARTY) return 1;
    if (b.label === UNKNOWN_PARTY) return -1;
    return collator.compare(a.label, b.label);
  });
}

function partyState(filters: FilterSettings): ExcludeTextState | undefined {
  return filters[PARTY_FILTER_ID] as ExcludeTextState | undefined;
}

export function blockedParties(filters: FilterSettings): string[] {
  const state = partyState(filters);
  return state?.enabled ? [...(state.values ?? [])] : [];
}

export function withBlockedParty(filters: FilterSettings, label: string): FilterSettings {
  const values = partyState(filters)?.values ?? [];
  return {
    ...filters,
    [PARTY_FILTER_ID]: {
      enabled: true,
      values: values.includes(label) ? [...values] : [...values, label]
    }
  };
}

export function withoutBlockedParty(filters: FilterSettings, label: string): FilterSettings {
  const values = (partyState(filters)?.values ?? []).filter(value => value !== label);
  return {
    ...filters,
    [PARTY_FILTER_ID]: { enabled: values.length > 0, values }
  };
}
