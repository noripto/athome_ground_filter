import { isChallengeHtml } from './fetcher';
import { detailIdFromUrl, extractDetailLinks } from './markup';
import type { Favorite } from './types';

export const FAVORITE_URL = 'https://www.athome.co.jp/simple_favorite/regist';

export const FAVORITE_LIST_URL = 'https://www.athome.co.jp/personal/favorite/';

export const UNFAVORITE_URL = 'https://www.athome.co.jp/personal/favoriteajax/';

const ITEM = 'ks';
const ART = '14';

const SITECD = '00000';

const SREF = 'list_simple';

const TAB_CODE = '2030';
const TAB_SORT = '32';

const BUKKEN_RE = /^\d{7,}$/;

export function isFavouritable(id: string): boolean {
  return BUKKEN_RE.test(id);
}

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

const MAX_LIST_PAGES = 10;

export interface FavoriteList {
  ok: boolean;
  ids: string[];
  note: string;
}

function refuse(note: string): FavoriteList {
  return { ok: false, ids: [], note };
}

function idsOnPage(html: string, url: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return extractDetailLinks(doc, url)
    .map(detailIdFromUrl)
    .filter((id): id is string => id !== null);
}

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
  body: string;
}

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
