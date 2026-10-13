import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'
import react from '@vitejs/plugin-react'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

// Dev server for the API and the pages. swc compiles both sides —
// decorators on the server, JSX (tsconfig "jsx": "react-jsx") in
// src/client — and react() adds Fast Refresh.
export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite(),
    react(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    // Watches .env files and triggers a full reload on change so the
    // dev server picks up env tweaks without a manual restart.
    envWatchPlugin(),
  ],
  // The server renders the HTML, so Vite has no index.html to scan for the
  // browser's dependencies — name the entry and the CommonJS ones.
  optimizeDeps: {
    entries: ['src/client/main.tsx'],
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  // @kick:vite-option
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'node20',
    ssr: true,
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      output: { format: 'esm' },
    },
  },
})
