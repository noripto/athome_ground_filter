import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const CSS_TOKEN = '__AGF_INLINE_CSS__';

function inlineCss(): Plugin {
  return {
    name: 'agf-inline-css',
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
