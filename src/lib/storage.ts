import { getDefaultFilters, getDefaultSettings } from './config';
import type { FilterSettings, ResultSet, Settings } from './types';

const SETTINGS_KEY = 'agfSettings';
const RESULTS_KEY = 'agfResults';

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

  return {
    targetCount: stored.targetCount ?? defaults.targetCount,
    requestDelayMs: stored.requestDelayMs ?? defaults.requestDelayMs,
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
