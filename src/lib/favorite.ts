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

export const FAVORITE_URL = 'https://www.athome.co.jp/simple_favorite/regist';

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
