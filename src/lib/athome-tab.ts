import type { FavoriteList } from './favorite';
import { FAVORITE, FAVORITES, PING, UNFAVORITE, type FavoriteReply } from './messages';

const CONTENT_SCRIPT_MATCH = 'https://www.athome.co.jp/tochi/*/list/*';

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 400;

const REPLY_TIMEOUT_MS = 30_000;

let known: number | null = null;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function answers(tabId: number): Promise<boolean> {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: PING });
    return reply?.ok === true;
  } catch {
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

export async function athomeTab(searchUrl: string): Promise<number> {
  if (known !== null && (await answers(known))) return known;
  known = (await existingTab()) ?? (await openTab(searchUrl));
  return known;
}

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
    if (!reply)
      throw new Error('athome のタブが応答しませんでした（タブを再読み込みしてください）');
    return reply;
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

export function sendFavorite(id: string, searchUrl: string): Promise<FavoriteReply> {
  return send(FAVORITE, id, searchUrl);
}

export function sendUnfavorite(id: string, searchUrl: string): Promise<FavoriteReply> {
  return send(UNFAVORITE, id, searchUrl);
}

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
