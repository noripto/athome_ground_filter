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
  /**
   * How to read the value. Percentages are plain numbers, but a price is
   * written 「1億500万円」, an area 「132.45m²（40.06坪）」 and a walk 「徒歩12分」
   * inside a whole transit description — none of which survives being read as
   * the first number in the string.
   */
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
  /**
   * How many *passing* properties to look for. Excluded ones do not count.
   * Zero means every property the search has, capped only by the safety limit.
   */
  targetCount: number;
  /** Delay between detail-page fetches, in ms. Keeps the crawl polite. */
  requestDelayMs: number;
  /**
   * How long a cached detail page is trusted. Detail fields barely change, so
   * this can be generous; the price and whether a listing is still up come
   * from the list pages, which are re-read every run regardless.
   */
  detailMaxAgeDays: number;
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

/**
 * A detail page as it was read, kept so the next run does not have to read it
 * again. This is the expensive half of a crawl and the half that does not
 * change: 都市計画 and 地目 are the same next week.
 */
export interface Detail {
  id: string;
  fields: Record<string, string>;
  name: string;
  price: string;
  area: string;
  location: string;
  traffic: string;
  /** When this was read, which is what decides whether it is still trusted. */
  fetchedAt: number;
}

/** What one search has produced, so an interrupted run can pick up again. */
export interface SearchRecord {
  /** The search URL with paging and tracking stripped, so pages share it. */
  searchKey: string;
  searchUrl: string;
  totalCount: number | null;
  pagesCrawled: number;
  /** Every property this search has turned up, in the order it did. */
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
  /** The listing's own name, as athome prints it in the detail page heading. */
  name: string;
  price: string;
  area: string;
  location: string;
  traffic: string;
  fields: Record<string, string>;
}

/** Whether athome's own favourite list has this property too. */
export type RemoteState = 'unsent' | 'ok' | 'failed';

/**
 * A starred property. It keeps a copy of the result rather than a reference to
 * one, so a star survives clearing the cache, a re-run that no longer turns the
 * property up, and the listing being taken off athome altogether.
 */
export interface Favorite {
  /** The property number — `Listing.id`, and athome's own BUKKEN. */
  id: string;
  addedAt: number;
  property: PropertyResult;
  /**
   * Whether this star was made here or found on athome. One picked up from
   * athome may be all but empty, and saying where it came from is what makes
   * that look deliberate rather than broken.
   */
  origin?: 'extension' | 'athome';
  remote: RemoteState;
  /** Why athome refused, when it did. Shown so a failure is not a mystery. */
  remoteNote: string;
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
  /** Read from the cache instead of the site — the work a re-run saved. */
  cached: number;
  pagesCrawled: number;
  stoppedBy: StopReason;
  /** The cap on inspected properties that applied to this run. */
  inspectLimit: number;
  activeFilters: string[];
  /**
   * Where the list pages were read from, at their poorest. Absent on results
   * stored before this was recorded.
   */
  source?: 'state' | 'cards' | 'links' | null;
  properties: PropertyResult[];
}
