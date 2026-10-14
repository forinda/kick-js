import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'
import react from '@vitejs/plugin-react'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

// Dev server for the API and the pages. swc compiles the server, which
// needs decorator metadata; Vite's oxc compiles the pages, which lets
// react() hot-swap components on save (Fast Refresh) without a reload.
const client = /src\/client\/.+\.[jt]sx?$/

export default defineConfig({
  oxc: { include: client },
  plugins: [
    // swc's own config hook switches oxc off for every file; drop it so
    // the pages keep oxc.
    { ...swc.vite({ exclude: [/node_modules/, client] }), config: undefined },
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
  // Aliases come from tsconfig.json `paths` — one list for the server,
  // the pages and the editor.
  resolve: { tsconfigPaths: true },
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
