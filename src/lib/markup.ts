/**
 * Everything that reads athome's markup, kept apart from the crawl that walks
 * it and the fetching underneath. Nothing here touches the network, so it is
 * also the part that can be exercised without a browser.
 *
 * A results card already prints 価格 / 土地面積 / 所在地 / 交通 and a few
 * regulation figures, at a cost of one request per fifty properties. Anything
 * ruled out from that is a detail page — one request for one property — never
 * opened.
 */

import { findField } from './evaluate';
import type { Listing } from './types';

/** Property detail URLs look like /tochi/[area/]1234567/ — the digits are the id. */
const DETAIL_URL_RE = /www\.athome\.co\.jp\/tochi\/(?:[^/\d][^/]*\/)?(\d{7,})\//;

/**
 * athome prints the hit count for the current search in the page header, split
 * across spans, so the number is read by anchoring on the class rather than on
 * the surrounding text.
 */
const TOTAL_COUNT_RE = /area-top__property--number[^>]*>\s*([\d,]+)\s*</;

/** One search result. Recommendation panels use other classes entirely. */
const CARD_SELECTOR = '.card-box-inner';

function detailUrlFromId(id: string): string {
  return `https://www.athome.co.jp/tochi/${id}/`;
}

/** The athome property id inside a detail URL, or null if it is not one. */
export function detailIdFromUrl(url: string): string | null {
  return url.match(DETAIL_URL_RE)?.[1] ?? null;
}

/** Collects unique detail URLs out of any document, preserving DOM order. */
export function extractDetailLinks(root: Document | ParentNode, baseUrl: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const anchor of root.querySelectorAll('a[href]')) {
    const raw = anchor.getAttribute('href');
    if (!raw) continue;

    let href: string;
    try {
      href = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }

    const match = href.match(DETAIL_URL_RE);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    urls.push(detailUrlFromId(match[1]));
  }

  return urls;
}

/** The hit count athome reports for a search, or null if the page omits it. */
export function parseTotalCount(html: string): number | null {
  const match = html.match(TOTAL_COUNT_RE);
  if (!match) return null;
  const count = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(count) ? count : null;
}

/**
 * Strips interactive chrome out of a cell before reading it, so values don't
 * pick up junk like 「地図を見る」 that the site renders inside table cells.
 */
export function cleanText(el: Element | null | undefined): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  for (const junk of clone.querySelectorAll(
    'a, button, script, style, input, select, [role="button"]'
  )) {
    junk.remove();
  }
  return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Reads every th/td and dt/dd pair on a detail page into a flat field map. */
export function parseDetailFields(doc: Document): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const row of doc.querySelectorAll('tr')) {
    const headers = [...row.querySelectorAll('th')];
    const cells = [...row.querySelectorAll('td')];
    headers.forEach((th, i) => {
      const key = th.textContent?.replace(/\s+/g, '') ?? '';
      if (key) fields[key] = cleanText(cells[i]);
    });
  }

  for (const dt of doc.querySelectorAll('dl dt')) {
    const dd = dt.nextElementSibling;
    if (dd?.tagName !== 'DD') continue;
    const key = dt.textContent?.replace(/\s+/g, '') ?? '';
    if (key) fields[key] = cleanText(dd);
  }

  return fields;
}

/**
 * The listing's own name. athome prints it in the page heading — either a
 * development name (「【積水ハウス】コモンステージ武蔵村山大南」) or just the
 * neighbourhood (「久が原３丁目」). Falls back to the address when a page has
 * no heading at all.
 */
export function readDetailName(
  doc: Document,
  fields: Record<string, string>,
  location: string
): string {
  const heading = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
  return heading || findField(fields, '物件名') || location;
}

/**
 * Cards pair a label with its value as `<strong>土地面積</strong><span>…</span>`,
 * the same shape the detail page uses for its table, so both end up in the
 * same flat field map and the same filters read them.
 */
/**
 * 「建ぺい率/容積率」holds two figures under one label. Left joined, a lookup
 * for either name would match the pair and read the first number as both, so
 * a label that splits evenly against its value becomes separate fields.
 */
export function splitFieldPair(key: string, value: string): [string, string][] {
  const keys = key.split('/');
  const values = value.split('/');
  if (keys.length < 2 || keys.length !== values.length) return [[key, value]];
  return keys.map((k, i) => [k.trim(), values[i].trim()] as [string, string]);
}

function parseCardFields(card: Element): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const label of card.querySelectorAll('strong')) {
    const key = label.textContent?.replace(/\s+/g, '') ?? '';
    const value = cleanText(label.nextElementSibling);
    if (!key || !value) continue;

    for (const [k, v] of splitFieldPair(key, value)) {
      if (k && !(k in fields)) fields[k] = v;
    }
  }

  return fields;
}

/**
 * The card's heading holds the property name with the price nested inside it,
 * so the price has to come out before the name reads as a name.
 */
function readCardName(card: Element): string {
  const heading = card.querySelector('.title-wrap__title-text');
  if (!heading) return '';
  const clone = heading.cloneNode(true) as Element;
  for (const nested of clone.querySelectorAll('p')) nested.remove();
  return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** The price is assembled from separate spans (「1,650」「万」「円」). */
function readCardPrice(card: Element): string {
  return cleanText(card.querySelector('.property-price')).replace(/\s+/g, '');
}

/**
 * Reads every search result on a list page. Returns an empty array when the
 * markup no longer matches, which the caller treats as a reason to fall back
 * to harvesting bare links rather than as a page with no results.
 */
export function parseListingCards(root: Document | ParentNode, baseUrl: string): Listing[] {
  const listings: Listing[] = [];
  const seen = new Set<string>();

  for (const card of root.querySelectorAll(CARD_SELECTOR)) {
    const url = extractDetailLinks(card, baseUrl)[0];
    if (!url) continue;

    const id = detailIdFromUrl(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const fields = parseCardFields(card);
    listings.push({
      id,
      url,
      name: readCardName(card),
      price: readCardPrice(card),
      area: fields['土地面積'] ?? '',
      location: fields['所在地'] ?? '',
      traffic: fields['交通'] ?? '',
      fields
    });
  }

  return listings;
}

/** A listing standing in for a link found outside any recognisable card. */
export function bareListing(url: string): Listing {
  return {
    id: detailIdFromUrl(url) ?? url,
    url,
    name: '',
    price: '',
    area: '',
    location: '',
    traffic: '',
    fields: {}
  };
}
