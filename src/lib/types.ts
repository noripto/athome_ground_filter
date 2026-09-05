export type FilterType = 'exclude_text' | 'min_road_width' | 'require_contains' | 'numeric_range';

interface BaseFilterDef {
  id: string;
  label: string;
  detailKey: string;
  defaultEnabled: boolean;
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
  parseAs?: 'price' | 'area' | 'walk';
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
  targetCount: number;
  requestDelayMs: number;
  detailMaxAgeDays: number;
  keepExcluded: boolean;
  filters: FilterSettings;
}

export interface Listing {
  id: string;
  url: string;
  name: string;
  price: string;
  area: string;
  location: string;
  traffic: string;
  fields: Record<string, string>;
}

export interface Detail {
  id: string;
  fields: Record<string, string>;
  name: string;
  price: string;
  area: string;
  location: string;
  traffic: string;
  fetchedAt: number;
}

export interface SearchRecord {
  searchKey: string;
  searchUrl: string;
  totalCount: number | null;
  pagesCrawled: number;
  listingIds: string[];
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  stoppedBy: StopReason | null;
}

export interface PropertyResult {
  url: string;
  passed: boolean;
  reasons: string[];
  name: string;
  price: string;
  area: string;
  location: string;
  traffic: string;
  fields: Record<string, string>;
}

export type RemoteState = 'unsent' | 'ok' | 'failed';

export interface Favorite {
  id: string;
  addedAt: number;
  property: PropertyResult;
  origin?: 'extension' | 'athome';
  remote: RemoteState;
  remoteNote: string;
}

export type StopReason =
  'target' | 'exhausted' | 'limit' | 'complete' | 'aborted' | 'blocked' | 'http' | 'paging';

export interface ResultSet {
  timestamp: number;
  searchUrl: string;
  requested: number;
  totalCount: number | null;
  inspected: number;
  passed: number;
  excluded: number;
  failed: number;
  skipped: number;
  cached: number;
  pagesCrawled: number;
  stoppedBy: StopReason;
  inspectLimit: number;
  activeFilters: string[];
  source?: 'state' | 'cards' | 'links' | null;
  properties: PropertyResult[];
}
