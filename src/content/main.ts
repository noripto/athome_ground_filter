import { mount } from 'svelte';
import Panel from './Panel.svelte';
import { fetchFavoriteIds, postFavorite, postUnfavorite } from '../lib/favorite';
import {
  FAVORITE,
  isFavoriteMessage,
  isFavoritesMessage,
  isPing,
  type FavoriteReply
} from '../lib/messages';
import '../styles/app.css';

declare const __AGF_INLINE_CSS__: string;

const HOST_ID = 'agf-host';

function inject(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(__AGF_INLINE_CSS__);
  shadow.adoptedStyleSheets = [sheet];

  const root = document.createElement('div');
  root.className = 'agf-root';
  shadow.appendChild(root);

  mount(Panel, { target: root });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function listen(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isPing(message)) {
      sendResponse({ ok: true });
      return false;
    }
    if (isFavoritesMessage(message)) {
      (async () => {
        try {
          sendResponse(await fetchFavoriteIds());
        } catch (err) {
          sendResponse({ ok: false, ids: [], note: errorText(err) });
        }
      })();
      return true;
    }

    if (!isFavoriteMessage(message)) return false;

    const post = message.type === FAVORITE ? postFavorite : postUnfavorite;
    (async () => {
      try {
        const outcome = await post(message.id);
        sendResponse({ ...outcome, error: '' } satisfies FavoriteReply);
      } catch (err) {
        sendResponse({
          ok: false,
          status: 0,
          body: '',
          error: errorText(err)
        } satisfies FavoriteReply);
      }
    })();

    return true;
  });
}

inject();
listen();
