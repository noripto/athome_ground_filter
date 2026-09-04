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
  /**
   * How many *passing* properties to look for. Excluded ones do not count.
   * Zero means every property the search has, capped only by the safety limit.
   */
  targetCount: number;
  /** Delay between detail-page fetches, in ms. Keeps the crawl polite. */
  requestDelayMs: number;
  /** Also list properties that were excluded, with their reasons. */
  keepExcluded: boolean;
  filters: FilterSettings;
}

/**
 * What a search-results card says about a property, before its detail page is
 * opened. One request yields fifty of these, which is what makes it worth
 * ruling properties out here rather than one detail page at a time.
 */
export interface Listing {
  /** athome's property id, taken from the detail URL. */
  id: string;
  url: string;
  name: string;
  price: string;
  area: string;
  location: string;
  traffic: string;
  /** The card's own label/value pairs, in the shape detail pages use. */
  fields: Record<string, string>;
}

export interface PropertyResult {
  url: string;
  passed: boolean;
  reasons: string[];
  /** The listing's own name, as athome prints it in the detail page heading. */
  name: string;
  price: string;
  area: string;
  location: string;
  traffic: string;
  fields: Record<string, string>;
}

/**
 * Why the crawl stopped. `exhausted` used to stand in for every ending that
 * wasn't the goal or a cap, which hid real failures behind a message telling
 * the user to widen their search; the rest of these name those failures.
 * Results stored by older versions only ever carry the first three.
 */
export type StopReason =
  /** The requested number of passing properties was found. */
  | 'target'
  /** The search ran dry before the goal was met. */
  | 'exhausted'
  /** A safety cap on pages or detail fetches was reached. */
  | 'limit'
  /** Every page the search says it has was read. */
  | 'complete'
  /** The user pressed cancel. */
  | 'aborted'
  /** athome kept answering with its bot check. */
  | 'blocked'
  /** Requests kept failing after every retry. */
  | 'http'
  /** A list page came back identical to the one before it. */
  | 'paging';

export interface ResultSet {
  timestamp: number;
  searchUrl: string;
  /** How many passing properties were asked for. Zero means「全件」. */
  requested: number;
  /** The hit count athome reports for this search, when it could be read. */
  totalCount: number | null;
  /** How many detail pages were opened to find them. */
  inspected: number;
  passed: number;
  excluded: number;
  failed: number;
  /** Excluded by their card alone, so no detail page was ever opened. */
  skipped: number;
  pagesCrawled: number;
  stoppedBy: StopReason;
  /** The cap on inspected properties that applied to this run. */
  inspectLimit: number;
  activeFilters: string[];
  properties: PropertyResult[];
}
