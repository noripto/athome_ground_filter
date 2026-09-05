/**
 * Reaching a page on athome.co.jp from the extension's own tab.
 *
 * Favourite registrations have to be posted from athome's origin (see
 * `favorite.ts`), so they are handed to the content script. This finds a tab
 * the content script is running in, or opens one in the background, and keeps
 * the answer for the rest of the session.
 */

import { FAVORITE, PING, type FavoriteReply } from './messages';

/** Must stay in step with `content_scripts.matches` in the manifest. */
const CONTENT_SCRIPT_MATCH = 'https://www.athome.co.jp/tochi/*/list/*';

/** How long a freshly opened tab is given to run its content script. */
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 400;

let known: number | null = null;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Whether the content script in this tab is up and listening. */
async function answers(tabId: number): Promise<boolean> {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: PING });
    return reply?.ok === true;
  } catch {
    // No receiver: the tab has navigated away, or has not run the script yet.
    return false;
  }
}

async function existingTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: CONTENT_SCRIPT_MATCH });
  for (const tab of tabs) {
    if (tab.id !== undefined && (await answers(tab.id))) return tab.id;
  }
  return null;
}

/**
 * The search being shown is itself a list page, so opening it is both a page
 * the content script runs on and one the user would recognise if they noticed
 * the tab.
 */
async function openTab(searchUrl: string): Promise<number> {
  const tab = await chrome.tabs.create({ url: searchUrl, active: false });
  if (tab.id === undefined) throw new Error('athome のタブを開けませんでした');

  const until = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < until) {
    await delay(READY_POLL_MS);
    if (await answers(tab.id)) return tab.id;
  }
  throw new Error('athome のタブが応答しません（ボット検知の可能性があります）');
}

/**
 * A tab that can post to athome. Reuses one the user already has open before
 * opening its own, so a normal session never grows a tab it did not ask for.
 */
export async function athomeTab(searchUrl: string): Promise<number> {
  if (known !== null && (await answers(known))) return known;
  known = (await existingTab()) ?? (await openTab(searchUrl));
  return known;
}

/** Registers one property on athome, through whatever tab is available. */
export async function sendFavorite(id: string, searchUrl: string): Promise<FavoriteReply> {
  try {
    const tabId = await athomeTab(searchUrl);
    return await chrome.tabs.sendMessage(tabId, { type: FAVORITE, id });
  } catch (err) {
    known = null;
    return {
      ok: false,
      status: 0,
      body: '',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
