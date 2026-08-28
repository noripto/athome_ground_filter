import { mount } from 'svelte';
import Panel from './Panel.svelte';
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

inject();
