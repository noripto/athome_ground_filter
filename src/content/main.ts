import { mount } from 'svelte';
import Panel from './Panel.svelte';
import { postFavorite, postUnfavorite } from '../lib/favorite';
import { FAVORITE, isFavoriteMessage, isPing, type FavoriteReply } from '../lib/messages';
import '../styles/app.css';

// Replaced at build time by the agf-inline-css plugin in vite.content.config.ts.
declare const __AGF_INLINE_CSS__: string;

const HOST_ID = 'agf-host';

function inject(): void {
  if (document.getElementById(HOST_ID)) return;

  // A shadow root keeps athome.co.jp's stylesheet from reaching the panel and
  // vice versa, so neither side needs defensive class-name prefixes.
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

/**
 * The results page cannot post to athome itself — its origin is the
 * extension's, which athome would see as a cross-site write — so it asks this
 * script to do it. Answering the ping is how it knows this tab is usable.
 */
function listen(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isPing(message)) {
      sendResponse({ ok: true });
      return false;
    }
    if (!isFavoriteMessage(message)) return false;

    const post = message.type === FAVORITE ? postFavorite : postUnfavorite;
    post(message.id)
      .then(outcome => sendResponse({ ...outcome, error: '' } satisfies FavoriteReply))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          status: 0,
          body: '',
          error: err instanceof Error ? err.message : String(err)
        } satisfies FavoriteReply)
      );

    // Keeps the channel open for the await above.
    return true;
  });
}

inject();
listen();
