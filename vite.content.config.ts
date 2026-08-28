import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const CSS_TOKEN = '__AGF_INLINE_CSS__';

/**
 * Chrome injects the content script as a plain file, and the panel renders into
 * a shadow root, so a separate .css asset would never reach it. This folds the
 * whole stylesheet back into the bundle as a string literal that main.ts adopts.
 */
function inlineCss(): Plugin {
  return {
    name: 'agf-inline-css',
    // Must run after vite's own css-post plugin, which is what emits the sheet.
    enforce: 'post',
    generateBundle(_options, bundle) {
      let css = '';
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !fileName.endsWith('.css')) continue;
        css += typeof asset.source === 'string' ? asset.source : asset.source.toString();
        delete bundle[fileName];
      }

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.code.includes(CSS_TOKEN)) continue;
        chunk.code = chunk.code.replaceAll(CSS_TOKEN, JSON.stringify(css));
      }
    }
  };
}

// The content script must be one self-contained IIFE: Chrome loads it as a
// classic script, so no import statements and no code-splitting are allowed.
export default defineConfig({
  plugins: [svelte(), inlineCss()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome114',
    cssCodeSplit: false,
    lib: {
      entry: 'src/content/main.ts',
      formats: ['iife'],
      name: 'AthomeGroundFilter',
      fileName: () => 'content.js'
    }
  }
});
