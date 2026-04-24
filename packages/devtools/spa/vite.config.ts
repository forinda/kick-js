import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwind from '@tailwindcss/vite'
import { resolve } from 'node:path'

/**
 * SPA build config for the KickJS DevTools panel.
 *
 * Output goes to `../public/spa/` so the adapter can serve it as a
 * static asset. Bundle is single-file (CSS inlined, no chunk splits)
 * because the panel needs to work offline + first-paint matters more
 * than HTTP/2 chunk parallelism for a single-page admin tool.
 */
export default defineConfig({
  plugins: [solid(), tailwind()],
  base: '/_debug/',
  build: {
    outDir: resolve(__dirname, '..', 'public', 'spa'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Single chunk — keeps initial-load size predictable and
        // dodges chunk-split races when serving over HTTP without
        // index hints.
        manualChunks: undefined,
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
