/**
 * The crawl's memory.
 *
 * Detail pages are the expensive half of a run — one request per property —
 * and what they say (都市計画, 地目, 接道…) does not change. Keeping them means
 * a second run only pays for properties it has never seen. List pages stay
 * cheap enough to re-read every time, which is also what keeps prices current
 * and reveals which listings have gone.
 *
 * chrome.storage.local caps out at 10MB, which a whole prefecture's worth of
 * field maps runs past, so this lives in IndexedDB. No wrapper library: the
 * extension has no runtime dependencies and this needs three stores.
 */

import type { Detail, Favorite, Listing, SearchRecord } from './types';

const DB_NAME = 'agf';
const DB_VERSION = 2;

const LISTINGS = 'listings';
const DETAILS = 'details';
const SEARCHES = 'searches';
const FAVORITES = 'favorites';

/** How long a stored detail page is trusted before it is read again. */
export const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LISTINGS)) {
        db.createObjectStore(LISTINGS, { keyPath: 'id' }).createIndex('seenAt', 'seenAt');
      }
      if (!db.objectStoreNames.contains(DETAILS)) {
        db.createObjectStore(DETAILS, { keyPath: 'id' }).createIndex('fetchedAt', 'fetchedAt');
      }
      if (!db.objectStoreNames.contains(SEARCHES)) {
        db.createObjectStore(SEARCHES, { keyPath: 'searchKey' });
      }
      // Added in version 2. Every branch here is guarded, so a database made by
      // either version upgrades to this one without losing what it holds.
      if (!db.objectStoreNames.contains(FAVORITES)) {
        db.createObjectStore(FAVORITES, { keyPath: 'id' }).createIndex('addedAt', 'addedAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return opening;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/**
 * A stored detail page counts as usable when it is present and not older than
 * `maxAgeMs`. Split out from the store so the rule can be exercised directly.
 */
export function isFresh(detail: Detail | undefined, now: number, maxAgeMs: number): boolean {
  if (!detail) return false;
  return now - detail.fetchedAt <= maxAgeMs;
}

export function getDetail(id: string): Promise<Detail | undefined> {
  return run<Detail | undefined>(DETAILS, 'readonly', store => store.get(id));
}

export function putDetail(detail: Detail): Promise<unknown> {
  return run(DETAILS, 'readwrite', store => store.put(detail));
}

export function putListing(listing: Listing & { seenAt: number }): Promise<unknown> {
  return run(LISTINGS, 'readwrite', store => store.put(listing));
}

/**
 * What a past crawl saw of a property from the list pages alone. Poorer than a
 * detail page but enough to name and price a star that was registered on
 * athome's own site rather than here.
 */
export function getListing(id: string): Promise<(Listing & { seenAt: number }) | undefined> {
  return run<(Listing & { seenAt: number }) | undefined>(LISTINGS, 'readonly', store =>
    store.get(id)
  );
}

export function getSearch(searchKey: string): Promise<SearchRecord | undefined> {
  return run<SearchRecord | undefined>(SEARCHES, 'readonly', store => store.get(searchKey));
}

export function putSearch(record: SearchRecord): Promise<unknown> {
  return run(SEARCHES, 'readwrite', store => store.put(record));
}

export function listFavorites(): Promise<Favorite[]> {
  return run<Favorite[]>(FAVORITES, 'readonly', store => store.getAll());
}

export function putFavorite(favorite: Favorite): Promise<unknown> {
  return run(FAVORITES, 'readwrite', store => store.put(favorite));
}

export function deleteFavorite(id: string): Promise<unknown> {
  return run(FAVORITES, 'readwrite', store => store.delete(id));
}

/**
 * Clears everything the crawl remembers, so the next run pays full price.
 * Favourites are deliberately not in the list: they are the user's own marks,
 * not something the crawl can read again.
 */
export async function clearCache(): Promise<void> {
  const db = await openDb();
  await Promise.all(
    [LISTINGS, DETAILS, SEARCHES].map(
      name =>
        new Promise<void>((resolve, reject) => {
          const request = db.transaction(name, 'readwrite').objectStore(name).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        })
    )
  );
}

/** How many detail pages are held, which is what a run gets to skip. */
export function countDetails(): Promise<number> {
  return run<number>(DETAILS, 'readonly', store => store.count());
}
