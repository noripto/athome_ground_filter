import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Extension pages (popup / options / results). The content script is built
// separately by vite.content.config.ts because it must be a single IIFE file.
export default defineConfig({
  plugins: [svelte()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    // `pnpm clean` owns wiping dist/, so that the two builds (and their two
    // watchers) never delete each other's output.
    emptyOutDir: false,
    target: 'chrome114',
    rollupOptions: {
      input: {
        popup: 'popup.html',
        options: 'options.html',
        results: 'results.html'
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
