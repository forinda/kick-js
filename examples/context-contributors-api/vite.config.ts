import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite(),
    // Wires Vite's SSR pipeline to mount the Express app exported from src/index.ts.
    // Without this plugin, Vite serves static files and returns 404 for API routes.
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    // Reload the dev server when .env files change.
    envWatchPlugin(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    watch: { usePolling: false },
    hmr: true,
  },
  ssr: {
    external: ['pino', 'pino-pretty'],
  },
  build: {
    target: 'node20',
    ssr: true,
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.ts'),
      output: { format: 'esm' },
    },
  },
})
