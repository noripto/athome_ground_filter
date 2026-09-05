import { findField } from './evaluate';
import type { Listing } from './types';

const DETAIL_URL_RE = /www\.athome\.co\.jp\/tochi\/(?:[^/\d][^/]*\/)?(\d{7,})\//;

const TOTAL_COUNT_RE = /area-top__property--number[^>]*>\s*([\d,]+)\s*</;

const CARD_SELECTOR = '.card-box-inner';

function detailUrlFromId(id: string): string {
  return `https://www.athome.co.jp/tochi/${id}/`;
}

export function detailIdFromUrl(url: string): string | null {
  return url.match(DETAIL_URL_RE)?.[1] ?? null;
}

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

export function parseTotalCount(html: string): number | null {
  const match = html.match(TOTAL_COUNT_RE);
  if (!match) return null;
  const count = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(count) ? count : null;
}

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

export function readDetailName(
  doc: Document,
  fields: Record<string, string>,
  location: string
): string {
  const heading = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
  return heading || findField(fields, '物件名') || location;
}

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

function readCardName(card: Element): string {
  const heading = card.querySelector('.title-wrap__title-text');
  if (!heading) return '';
  const clone = heading.cloneNode(true) as Element;
  for (const nested of clone.querySelectorAll('p')) nested.remove();
  return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function readCardPrice(card: Element): string {
  return cleanText(card.querySelector('.property-price')).replace(/\s+/g, '');
}

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
    const price = readCardPrice(card);

    if (price && !('価格' in fields)) fields['価格'] = price;

    listings.push({
      id,
      url,
      name: readCardName(card),
      price,
      area: fields['土地面積'] ?? '',
      location: fields['所在地'] ?? '',
      traffic: fields['交通'] ?? '',
      fields
    });
  }

  return listings;
}

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
