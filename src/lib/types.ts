/** Shape of every filter definition and of the settings the user edits. */

export type FilterType = 'exclude_text' | 'min_road_width' | 'require_contains' | 'numeric_range';

interface BaseFilterDef {
  id: string;
  label: string;
  /** Key looked up in the detail page's field table (partial match). */
  detailKey: string;
  defaultEnabled: boolean;
  /** Short explanation shown under the row in the settings UI. */
  help?: string;
}

export interface ExcludeTextDef extends BaseFilterDef {
  type: 'exclude_text';
  defaultValues: string[];
  hints: string[];
}

export interface MinRoadWidthDef extends BaseFilterDef {
  type: 'min_road_width';
  defaultMinWidth: number;
  unit: string;
}

export interface RequireContainsDef extends BaseFilterDef {
  type: 'require_contains';
  defaultRequired: string;
}

export interface NumericRangeDef extends BaseFilterDef {
  type: 'numeric_range';
  unit: string;
  defaultMin: number | null;
  defaultMax: number | null;
}

export type FilterDef = ExcludeTextDef | MinRoadWidthDef | RequireContainsDef | NumericRangeDef;

export interface ExcludeTextState {
  enabled: boolean;
  values: string[];
}
export interface MinRoadWidthState {
  enabled: boolean;
  minWidth: number;
}
export interface RequireContainsState {
  enabled: boolean;
  required: string;
}
export interface NumericRangeState {
  enabled: boolean;
  min: number | null;
  max: number | null;
}

export type FilterState =
  ExcludeTextState | MinRoadWidthState | RequireContainsState | NumericRangeState;

export type FilterSettings = Record<string, FilterState>;

export interface Settings {
  /** How many *passing* properties to look for. Excluded ones do not count. */
  targetCount: number;
  /** Delay between detail-page fetches, in ms. Keeps the crawl polite. */
  requestDelayMs: number;
  /** Also list properties that were excluded, with their reasons. */
  keepExcluded: boolean;
  filters: FilterSettings;
}

export interface PropertyResult {
  url: string;
  passed: boolean;
  reasons: string[];
  price: string;
  area: string;
  location: string;
  traffic: string;
  title: string;
  fields: Record<string, string>;
}

export interface ResultSet {
  timestamp: number;
  searchUrl: string;
  /** Properties actually inspected (== requested count, or fewer if the search ran out). */
  total: number;
  passed: number;
  excluded: number;
  failed: number;
  requested: number;
  pagesCrawled: number;
  activeFilters: string[];
  properties: PropertyResult[];
}
