import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'
import vue from '@vitejs/plugin-vue'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

// Dev server for the API and the pages. swc compiles the server, which
// needs decorator metadata; vue() and Vite's oxc compile the pages, which
// hot-swaps components on save without a reload.
const client = /src\/client\/.+\.[jt]sx?$/

export default defineConfig({
  oxc: { include: client },
  plugins: [
    // swc's own config hook switches oxc off for every file; drop it so
    // the pages keep oxc. Globs, not the regex above: unplugin-swc's options
    // type takes swc's `exclude` (strings) for its own filter.
    { ...swc.vite({ exclude: ['**/node_modules/**', '**/src/client/**'] }), config: undefined },
    vue(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    // Watches .env files and triggers a full reload on change so the
    // dev server picks up env tweaks without a manual restart.
    envWatchPlugin(),
  ],
  // The server renders the HTML, so Vite has no index.html to scan for the
  // browser's dependencies — name the entry.
  optimizeDeps: { entries: ['src/client/main.ts'] },
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
