/**
 * Reaching a page on athome.co.jp from the extension's own tab.
 *
 * Favourite registrations have to be posted from athome's origin (see
 * `favorite.ts`), so they are handed to the content script. This finds a tab
 * the content script is running in, or opens one in the background, and keeps
 * the answer for the rest of the session.
 */

import type { FavoriteList } from './favorite';
import { FAVORITE, FAVORITES, PING, UNFAVORITE, type FavoriteReply } from './messages';

/** Must stay in step with `content_scripts.matches` in the manifest. */
const CONTENT_SCRIPT_MATCH = 'https://www.athome.co.jp/tochi/*/list/*';

/** How long a freshly opened tab is given to run its content script. */
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 400;

/**
 * How long one post may take before it is called a failure. A content script
 * that recognises no listener for a message never answers, and nothing else
 * gives up on our behalf — which is how a guard that rejected the removal
 * message showed up as a button stuck on「通信中」rather than as an error.
 */
const REPLY_TIMEOUT_MS = 30_000;

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

/**
 * Registers or removes one property on athome, through whatever tab is
 * available. A failure here is reported rather than thrown: the caller has
 * already saved the user's own mark and only needs to say what athome did.
 */
function timeout(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('応答がありません（30秒）')), REPLY_TIMEOUT_MS)
  );
}

async function send(
  type: typeof FAVORITE | typeof UNFAVORITE,
  id: string,
  searchUrl: string
): Promise<FavoriteReply> {
  try {
    const tabId = await athomeTab(searchUrl);
    const reply = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type, id }) as Promise<FavoriteReply | undefined>,
      timeout()
    ]);
    // An undefined reply is a content script that took the message and never
    // answered — an older build in a tab that has not been reloaded, usually.
    if (!reply)
      throw new Error('athome のタブが応答しませんでした（タブを再読み込みしてください）');
    return reply;
  } catch (err) {
    // Whatever tab was in use is gone or unreachable. Forgetting it means the
    // next property looks for another one instead of failing the same way.
    known = null;
    return {
      ok: false,
      status: 0,
      body: '',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export function sendFavorite(id: string, searchUrl: string): Promise<FavoriteReply> {
  return send(FAVORITE, id, searchUrl);
}

export function sendUnfavorite(id: string, searchUrl: string): Promise<FavoriteReply> {
  return send(UNFAVORITE, id, searchUrl);
}

/**
 * athome's own favourite list, read through a tab on its origin. Failures come
 * back as a refusal rather than an exception, because the caller must be able
 * to tell「読めなかった」from「空だった」— acting on the second when it was the
 * first is how stars get lost.
 */
export async function sendFavoriteList(searchUrl: string): Promise<FavoriteList> {
  try {
    const tabId = await athomeTab(searchUrl);
    const reply = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: FAVORITES }) as Promise<FavoriteList | undefined>,
      timeout()
    ]);
    if (!reply) {
      throw new Error('athome のタブが応答しませんでした（タブを再読み込みしてください）');
    }
    return reply;
  } catch (err) {
    known = null;
    return { ok: false, ids: [], note: err instanceof Error ? err.message : String(err) };
  }
}
