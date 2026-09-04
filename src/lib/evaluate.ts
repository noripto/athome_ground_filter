import { FILTER_DEFS } from './config';
import { parseAreaSqm, parsePriceMan } from './numbers';
import type {
  ExcludeTextState,
  NumericRangeDef,
  FilterSettings,
  MinRoadWidthState,
  NumericRangeState,
  RequireContainsState
} from './types';

/**
 * Detail tables label the same concept slightly differently between listings
 * (「接道状況」 vs 「接道」), so keys are matched by containment either way.
 */
export function findField(fields: Record<string, string>, key: string): string {
  for (const [k, v] of Object.entries(fields)) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  return '';
}

function parseWidths(raw: string): number[] {
  return [...raw.matchAll(/(\d+(?:\.\d+)?)\s*m/gi)].map(m => Number.parseFloat(m[1]));
}

function parseLeadingNumber(raw: string): number | null {
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number.parseFloat(m[1]) : null;
}

/**
 * Percentages read fine as the first number in the cell, but prices and areas
 * do not: 「1億500万円」 leads with a 1, so a maximum of 2000万 used to let
 * every property over a hundred million straight through.
 */
function readRangeValue(raw: string, parseAs: NumericRangeDef['parseAs']): number | null {
  if (parseAs === 'price') return parsePriceMan(raw);
  if (parseAs === 'area') return parseAreaSqm(raw);
  return parseLeadingNumber(raw);
}

export interface EvaluateOptions {
  /**
   * Judge only the filters whose field is actually present. A results card
   * carries a handful of fields, and a filter looking at one of the others
   * must not read that absence as a failure — the detail page has yet to be
   * opened, so nothing is known either way.
   */
  presentFieldsOnly?: boolean;
}

/** Returns one reason per failed filter; an empty array means the property passes. */
export function evaluate(
  filters: FilterSettings,
  fields: Record<string, string>,
  options: EvaluateOptions = {}
): string[] {
  const reasons: string[] = [];

  for (const def of FILTER_DEFS) {
    const state = filters[def.id];
    if (!state?.enabled) continue;
    const raw = findField(fields, def.detailKey);
    if (options.presentFieldsOnly && raw === '') continue;

    switch (def.type) {
      case 'exclude_text': {
        const { values } = state as ExcludeTextState;
        const hit = (values ?? []).find(v => v && raw.includes(v));
        if (hit) reasons.push(`${def.label}: ${raw}`);
        break;
      }
      case 'require_contains': {
        const { required } = state as RequireContainsState;
        if (required && !raw.includes(required)) {
          reasons.push(`${def.label}: ${raw || '情報なし'}（「${required}」が必要）`);
        }
        break;
      }
      case 'min_road_width': {
        const { minWidth } = state as MinRoadWidthState;
        const widths = parseWidths(raw);
        if (widths.length > 0) {
          const narrowest = Math.min(...widths);
          if (narrowest <= minWidth) {
            reasons.push(`${def.label}: ${narrowest}${def.unit} ≤ ${minWidth}${def.unit}`);
          }
        }
        break;
      }
      case 'numeric_range': {
        const { min, max } = state as NumericRangeState;
        const n = readRangeValue(raw, def.parseAs);
        if (n === null) break;
        if (min !== null && n < min) reasons.push(`${def.label}: ${n}${def.unit} < ${min}`);
        if (max !== null && n > max) reasons.push(`${def.label}: ${n}${def.unit} > ${max}`);
        break;
      }
    }
  }

  return reasons;
}

/** Human-readable one-line summary of which filters are currently enabled. */
export function describeActiveFilters(filters: FilterSettings): string[] {
  const parts: string[] = [];

  for (const def of FILTER_DEFS) {
    const state = filters[def.id];
    if (!state?.enabled) continue;

    switch (def.type) {
      case 'exclude_text': {
        const { values } = state as ExcludeTextState;
        if (values?.length) parts.push(`${def.label}≠[${values.join(',')}]`);
        break;
      }
      case 'min_road_width':
        parts.push(`${def.label}>${(state as MinRoadWidthState).minWidth}${def.unit}`);
        break;
      case 'require_contains':
        parts.push(`${def.label}=${(state as RequireContainsState).required}`);
        break;
      case 'numeric_range': {
        const { min, max } = state as NumericRangeState;
        const bounds: string[] = [];
        if (min !== null) bounds.push(`≥${min}`);
        if (max !== null) bounds.push(`≤${max}`);
        if (bounds.length) parts.push(`${def.label}${bounds.join(' ')}${def.unit}`);
        break;
      }
    }
  }

  return parts;
}
