import type { Detail, Favorite, Listing, SearchRecord } from './types';

const DB_NAME = 'agf';
const DB_VERSION = 2;

const LISTINGS = 'listings';
const DETAILS = 'details';
const SEARCHES = 'searches';
const FAVORITES = 'favorites';

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

export function countDetails(): Promise<number> {
  return run<number>(DETAILS, 'readonly', store => store.count());
}
