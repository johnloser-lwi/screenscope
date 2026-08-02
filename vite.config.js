import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    // Only ever runs in Electron's bundled Chromium, and app.js loads its
    // persisted settings with a top-level await.
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        regionSelector: resolve(__dirname, 'src/renderer/region-selector.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
