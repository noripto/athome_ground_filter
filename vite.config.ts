import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome114',
    modulePreload: false,
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
