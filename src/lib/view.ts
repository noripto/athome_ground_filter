import { evaluate } from './evaluate';
import { parseAreaSqm, parsePriceMan, parseWalkMinutes, unitPriceManPerTsubo } from './numbers';
import type { FilterSettings, PropertyResult } from './types';

export type SortKey = 'found' | 'price' | 'area' | 'unitPrice' | 'walk';

export interface SortOption {
  key: SortKey;
  label: string;
  ascending: boolean;
}

export const SORT_OPTIONS: SortOption[] = [
  { key: 'found', label: '掲載順', ascending: true },
  { key: 'price', label: '価格が安い', ascending: true },
  { key: 'price', label: '価格が高い', ascending: false },
  { key: 'area', label: '面積が広い', ascending: false },
  { key: 'area', label: '面積が狭い', ascending: true },
  { key: 'unitPrice', label: '坪単価が安い', ascending: true },
  { key: 'walk', label: '駅から近い', ascending: true }
];

export interface Metrics {
  priceMan: number | null;
  areaSqm: number | null;
  unitPriceMan: number | null;
  walkMinutes: number | null;
}

export function metricsFor(property: PropertyResult): Metrics {
  const priceMan = parsePriceMan(property.price);
  const areaSqm = parseAreaSqm(property.area);
  return {
    priceMan,
    areaSqm,
    unitPriceMan: unitPriceManPerTsubo(priceMan, areaSqm),
    walkMinutes: parseWalkMinutes(property.traffic)
  };
}

function metricFor(metrics: Metrics, key: SortKey): number | null {
  switch (key) {
    case 'price':
      return metrics.priceMan;
    case 'area':
      return metrics.areaSqm;
    case 'unitPrice':
      return metrics.unitPriceMan;
    case 'walk':
      return metrics.walkMinutes;
    case 'found':
      return null;
  }
}

export function sortProperties(
  properties: readonly PropertyResult[],
  option: SortOption
): PropertyResult[] {
  if (option.key === 'found') {
    return option.ascending ? [...properties] : [...properties].reverse();
  }

  const direction = option.ascending ? 1 : -1;
  return properties
    .map((property, index) => ({
      property,
      index,
      value: metricFor(metricsFor(property), option.key)
    }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      if (a.value !== b.value) return (a.value - b.value) * direction;
      return a.index - b.index;
    })
    .map(entry => entry.property);
}

export function refilter(
  properties: readonly PropertyResult[],
  filters: FilterSettings
): PropertyResult[] {
  return properties.map(property => {
    if (Object.keys(property.fields).length === 0) return property;
    const reasons = evaluate(filters, property.fields);
    return { ...property, passed: reasons.length === 0, reasons };
  });
}

export interface ViewFilter {
  keyword: string;
  minPriceMan: number | null;
  maxPriceMan: number | null;
  minAreaSqm: number | null;
  maxAreaSqm: number | null;
  maxWalkMinutes: number | null;
}

export function emptyViewFilter(): ViewFilter {
  return {
    keyword: '',
    minPriceMan: null,
    maxPriceMan: null,
    minAreaSqm: null,
    maxAreaSqm: null,
    maxWalkMinutes: null
  };
}

export function isViewFilterActive(filter: ViewFilter): boolean {
  return (
    filter.keyword.trim() !== '' ||
    filter.minPriceMan !== null ||
    filter.maxPriceMan !== null ||
    filter.minAreaSqm !== null ||
    filter.maxAreaSqm !== null ||
    filter.maxWalkMinutes !== null
  );
}

function withinRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

export function applyViewFilter(
  properties: readonly PropertyResult[],
  filter: ViewFilter
): PropertyResult[] {
  if (!isViewFilterActive(filter)) return [...properties];

  const keyword = filter.keyword.trim().toLowerCase();

  return properties.filter(property => {
    if (keyword) {
      const haystack = `${property.name} ${property.location} ${property.traffic}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    const metrics = metricsFor(property);
    if (!withinRange(metrics.priceMan, filter.minPriceMan, filter.maxPriceMan)) return false;
    if (!withinRange(metrics.areaSqm, filter.minAreaSqm, filter.maxAreaSqm)) return false;
    if (!withinRange(metrics.walkMinutes, null, filter.maxWalkMinutes)) return false;

    return true;
  });
}
