/**
 * Reading athome's own data instead of the page it renders from it.
 *
 * Every list page ships its whole result set as Angular transfer state in a
 * trailing `<script type="application/json">`. That carries more per property
 * than the cards show — 土地権利, 建ぺい率, 容積率, 私道負担 — which means more
 * filters can be answered before any detail page is opened. It also does not
 * depend on class names, so a redesign of the cards does not silently turn the
 * pre-filtering off.
 */

import type { Listing } from './types';

const STATE_RE = /<script[^>]*id="serverApp-state"[^>]*>([\s\S]*?)<\/script>/;

/** Angular escapes a few characters when it inlines the state into the page. */
const ENTITIES: Record<string, string> = {
  a: '&',
  q: '"',
  s: "'",
  l: '<',
  g: '>',
  n: '\n'
};

function detailUrlFor(id: string): string {
  return `https://www.athome.co.jp/tochi/${id}/`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A dash is how athome writes 「none」 in these fields, not a value. */
function meaningful(value: unknown): string {
  const raw = text(value);
  return raw === '-' || raw === '―' ? '' : raw;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The transfer state as a plain object, or null if the page carries none. */
export function parseTransferState(html: string): Record<string, unknown> | null {
  const match = html.match(STATE_RE);
  if (!match) return null;

  const raw = match[1];
  for (const candidate of [raw, raw.replace(/&([aqslgn]);/g, (_, c) => ENTITIES[c])]) {
    try {
      return record(JSON.parse(candidate));
    } catch {
      // Fall through to the unescaped reading, then give up.
    }
  }
  return null;
}

function propertyList(state: Record<string, unknown>): Record<string, unknown>[] {
  const firstView = record(state['first-view-ITEMS']);
  const bukkenData = firstView && record(firstView.bukkenData);
  const list = bukkenData?.bukkenList;
  if (!Array.isArray(list)) return [];
  return list.map(record).filter((entry): entry is Record<string, unknown> => entry !== null);
}

/**
 * The price is split into 億 and 万 parts, once per end of a range, so it has
 * to be put back together: 「1,650万円」「～」「2,920万円」.
 */
function readPrice(kakaku: unknown): string {
  const price = record(kakaku);
  if (!price) return '';

  const parts = Array.isArray(price.priceText) ? price.priceText : [];
  const written = parts
    .map(record)
    .map(part => {
      if (!part) return '';
      const oku = text(part.priceOku);
      const man = text(part.priceMan);
      if (!oku && !man) return '';
      return `${oku ? `${oku}億` : ''}${man ? `${man}万` : ''}${text(part.unitText)}`;
    })
    .filter(Boolean);

  if (written.length === 0) return text(price.noPlan);
  return written.join(text(price.bufferText) || '～');
}

/** Every line the property is listed against, as one readable string. */
function readAccess(access: unknown): string {
  if (!Array.isArray(access)) return '';
  return access
    .map(record)
    .map(entry => text(entry?.accessText))
    .filter(Boolean)
    .join(' ／ ');
}

function toListing(entry: Record<string, unknown>): Listing | null {
  const id = text(entry.bukkenNo);
  if (!id) return null;

  const price = readPrice(entry.kakaku);
  const area = text(entry.landareaFromTo);
  const location = text(entry.location);
  const traffic = readAccess(entry.access);
  const detail = record(entry.propertyDetailData);

  // Keyed the way detail pages label the same things, so one set of filters
  // reads both without knowing which source it came from.
  const fields: Record<string, string> = {};
  const put = (key: string, value: string) => {
    if (value) fields[key] = value;
  };

  put('価格', price);
  put('土地面積', area);
  put('所在地', location);
  put('交通', traffic);
  put('土地権利', meaningful(entry.right));
  put('建ぺい率', meaningful(entry.buildingCoverageRatio));
  put('容積率', meaningful(entry.floorAreaRatio));
  put('私道負担面積', meaningful(entry.priroad));
  put('種目', meaningful(detail?.syumoku));

  return {
    id,
    // `urlLong` on these records is the agency's page, not the property's.
    url: detailUrlFor(id),
    name: text(entry.title) || location,
    price,
    area,
    location,
    traffic,
    fields
  };
}

/** Every property the page's transfer state describes, in its own order. */
export function listingsFromState(html: string): Listing[] {
  const state = parseTransferState(html);
  if (!state) return [];

  const seen = new Set<string>();
  const listings: Listing[] = [];

  for (const entry of propertyList(state)) {
    const listing = toListing(entry);
    if (!listing || seen.has(listing.id)) continue;
    seen.add(listing.id);
    listings.push(listing);
  }

  return listings;
}
