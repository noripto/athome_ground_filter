/**
 * athome's own favourite list.
 *
 * The request is a plain form post with no CSRF token — cookies are the whole
 * of the authentication. That is also why it cannot be sent from the results
 * page: an extension page's `Origin` is `chrome-extension://…`, and `Origin`
 * and `Sec-Fetch-Site` are forbidden headers that `fetch` will not let us set,
 * so athome would see a cross-site write. The post has to be made from a page
 * on athome.co.jp, which is what the content script is for.
 */

import { isChallengeHtml } from './fetcher';
import { detailIdFromUrl, extractDetailLinks } from './markup';
import type { Favorite } from './types';

export const FAVORITE_URL = 'https://www.athome.co.jp/simple_favorite/regist';

/** The page athome shows its own favourite list on. */
export const FAVORITE_LIST_URL = 'https://www.athome.co.jp/personal/favorite/';

/** Removal is a different endpoint, and a different shape, from registration. */
export const UNFAVORITE_URL = 'https://www.athome.co.jp/personal/favoriteajax/';

/**
 * Both are constants for land. athome's own 閲覧履歴 cookie stores every 土地
 * as `ks14` followed by the ten-digit property number, and this extension only
 * ever reads /tochi/, so neither varies per property. The site's list data
 * carries no field for them, which is the other half of the evidence: its own
 * page fills them in from the category.
 */
const ITEM = 'ks';
const ART = '14';

/** athome's main site, as opposed to its regional partners. */
const SITECD = '00000';

/** Where the click came from, which athome records for its own reporting. */
const SREF = 'list_simple';

/**
 * The favourite page's own view state, which its removal request carries along
 * — 2030 is its 土地 tab and 32 the sort it was on. Only `BUKKEN` and
 * `ITEMART` identify the property, so if athome ever objects to these, they are
 * the two to look at first.
 */
const TAB_CODE = '2030';
const TAB_SORT = '32';

/** A property number is all digits — the same string `Listing.id` holds. */
const BUKKEN_RE = /^\d{7,}$/;

export function isFavouritable(id: string): boolean {
  return BUKKEN_RE.test(id);
}

/**
 * The form body, in the order athome's own page sends it. Everything but the
 * property number is fixed, so a starred property needs nothing that the crawl
 * did not already read.
 */
export function favoriteBody(id: string): string {
  if (!isFavouritable(id)) throw new Error(`お気に入りに登録できない物件番号です: ${id}`);
  return new URLSearchParams({
    SITECD,
    ITEM,
    ART,
    BUKKEN: id,
    BUKKEN_ART: `${id}_${ART}`,
    sref: SREF
  }).toString();
}

/**
 * The removal body. `ITEMART` is the same two constants the registration sends
 * separately, run together — which is the site's own confirmation that neither
 * varies per property.
 */
export function unfavoriteBody(id: string): string {
  if (!isFavouritable(id)) throw new Error(`お気に入りから外せない物件番号です: ${id}`);
  return new URLSearchParams({
    DELFLG: '1',
    TAB_CODE,
    SORT: TAB_SORT,
    BUKKEN: id,
    ITEMART: `${ITEM}${ART}`
  }).toString();
}

/** How many pages of the favourite list one sync will walk. */
const MAX_LIST_PAGES = 10;

export interface FavoriteList {
  ok: boolean;
  ids: string[];
  /** Always worth saying: on failure it is the reason, on success the extent. */
  note: string;
}

/** Anything that means the page is not the logged-in favourite list. */
function refuse(note: string): FavoriteList {
  return { ok: false, ids: [], note };
}

/**
 * The property numbers on one page of the favourite list. `DETAIL_URL_RE` only
 * matches /tochi/ URLs, so the other categories' tabs are skipped without this
 * having to know which tab it is looking at.
 */
function idsOnPage(html: string, url: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return extractDetailLinks(doc, url)
    .map(detailIdFromUrl)
    .filter((id): id is string => id !== null);
}

/**
 * Links to further pages of the same list. The markup here has not been seen,
 * so this looks for the one thing that must be true of a paging link — it
 * points back at the favourite page — rather than for a class name.
 */
function furtherPages(html: string, url: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pages = new Set<string>();

  for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = new URL(anchor.getAttribute('href') ?? '', url).toString();
    if (!href.startsWith(FAVORITE_LIST_URL) || href === url) continue;
    if (!/[?&](PAGE|page|p)=\d+/.test(href)) continue;
    pages.add(href);
  }

  return [...pages];
}

/**
 * Every land property on athome's own favourite list.
 *
 * Must run in a page on athome.co.jp, like the registration. It refuses rather
 * than guesses whenever the answer is not recognisably the list — a caller that
 * removes local stars on what this returns would otherwise throw them away the
 * first time the session expires or the bot check fires.
 */
export async function fetchFavoriteIds(): Promise<FavoriteList> {
  const seen = new Set<string>();
  const queue = [`${FAVORITE_LIST_URL}?TAB_CODE=${TAB_CODE}&SORT=${TAB_SORT}`];
  const read: string[] = [];

  while (queue.length > 0 && read.length < MAX_LIST_PAGES) {
    const url = queue.shift() as string;
    if (read.includes(url)) continue;

    let res: Response;
    try {
      res = await fetch(url, { credentials: 'include' });
    } catch (err) {
      return refuse(
        `お気に入りページを読めませんでした: ${err instanceof Error ? err.message : err}`
      );
    }

    if (!res.ok) return refuse(`お気に入りページが HTTP ${res.status} を返しました`);
    // A redirect away from the favourite page is athome asking for a login.
    if (!res.url.startsWith(FAVORITE_LIST_URL)) {
      return refuse('athome にログインしていません（サイトでログインしてから再同期してください）');
    }

    const html = await res.text();
    if (isChallengeHtml(html))
      return refuse('athome のアクセス制限に掛かりました（時間を空けてください）');

    read.push(url);
    for (const id of idsOnPage(html, res.url)) seen.add(id);
    for (const next of furtherPages(html, res.url)) {
      if (!read.includes(next) && !queue.includes(next)) queue.push(next);
    }
  }

  const more = queue.length > 0 ? `（${MAX_LIST_PAGES}ページで打ち切り）` : '';
  return { ok: true, ids: [...seen], note: `${read.length}ページ / 土地 ${seen.size}件${more}` };
}

/**
 * What one sync should change, worked out without touching anything. Removals
 * only ever concern stars athome was actually told about: one that never got
 * there is absent from athome's list for a reason that has nothing to do with
 * the user having removed it.
 */
export function reconcile(
  local: readonly Favorite[],
  remoteIds: readonly string[]
): { toImport: string[]; toDrop: string[] } {
  const remote = new Set(remoteIds);
  const held = new Set(local.map(entry => entry.id));

  return {
    toImport: [...remote].filter(id => !held.has(id)),
    toDrop: local.filter(entry => entry.remote === 'ok' && !remote.has(entry.id)).map(e => e.id)
  };
}

export interface FavoriteOutcome {
  ok: boolean;
  status: number;
  /** Kept short: it is only ever read by a person working out what went wrong. */
  body: string;
}

/**
 * Registers one property. Must run in a page on athome.co.jp — see the note at
 * the top of this file. The response is returned rather than judged, because
 * what athome answers on success has not been observed yet.
 */
export async function postFavorite(id: string): Promise<FavoriteOutcome> {
  const res = await fetch(FAVORITE_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json, text/plain, */*'
    },
    body: favoriteBody(id)
  });

  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 400) };
}

/**
 * Removes one property. Must run in a page on athome.co.jp, like the
 * registration. athome's own request carries a referrer of the favourite page,
 * which cannot be reproduced here — `Referer` is a forbidden header and the
 * `referrer` option is not honoured for a content script's fetch. Registration
 * went through without one, so this does not try to fake it either.
 */
export async function postUnfavorite(id: string): Promise<FavoriteOutcome> {
  const res = await fetch(UNFAVORITE_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'text/html, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: unfavoriteBody(id)
  });

  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 400) };
}
