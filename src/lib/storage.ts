import { COUNT_PRESETS, getDefaultFilters, getDefaultSettings } from './config';
import type { FilterSettings, ResultSet, Settings } from './types';

const SETTINGS_KEY = 'agfSettings';
const RESULTS_KEY = 'agfResults';
const FAVORITE_SYNC_KEY = 'agfFavoriteSync';

/**
 * Merges stored settings over the defaults so that filters added in a later
 * version appear (disabled) instead of silently going missing.
 */
function normalize(stored: Partial<Settings> | undefined): Settings {
  const defaults = getDefaultSettings();
  if (!stored) return defaults;

  const filters: FilterSettings = getDefaultFilters();
  for (const [id, state] of Object.entries(stored.filters ?? {})) {
    if (id in filters) filters[id] = { ...filters[id], ...state };
  }

  // The count is chosen from buttons, so anything else came from an older
  // build and is dropped rather than leaving no button highlighted.
  const targetCount =
    stored.targetCount !== undefined && COUNT_PRESETS.includes(stored.targetCount)
      ? stored.targetCount
      : defaults.targetCount;

  return {
    targetCount,
    requestDelayMs: stored.requestDelayMs ?? defaults.requestDelayMs,
    detailMaxAgeDays: stored.detailMaxAgeDays ?? defaults.detailMaxAgeDays,
    keepExcluded: stored.keepExcluded ?? defaults.keepExcluded,
    filters
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalize(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

export async function resetSettings(): Promise<Settings> {
  const defaults = getDefaultSettings();
  await saveSettings(defaults);
  return defaults;
}

/** Fires whenever settings change in any other context (options page, panel…). */
export function onSettingsChanged(handler: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'sync' || !(SETTINGS_KEY in changes)) return;
    handler(normalize(changes[SETTINGS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function loadResults(): Promise<ResultSet | null> {
  const stored = await chrome.storage.local.get(RESULTS_KEY);
  return (stored[RESULTS_KEY] as ResultSet | undefined) ?? null;
}

export async function saveResults(results: ResultSet): Promise<void> {
  await chrome.storage.local.set({ [RESULTS_KEY]: results });
}

/**
 * When athome's own favourite list was last read. Kept out of IndexedDB with
 * the stars themselves: it describes the sync rather than the marks, and losing
 * it costs one extra request.
 */
export async function loadFavoriteSync(): Promise<number | null> {
  const stored = await chrome.storage.local.get(FAVORITE_SYNC_KEY);
  return (stored[FAVORITE_SYNC_KEY] as number | undefined) ?? null;
}

export async function saveFavoriteSync(at: number): Promise<void> {
  await chrome.storage.local.set({ [FAVORITE_SYNC_KEY]: at });
}
