import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    // Watches .env files and triggers a full reload on change so the
    // dev server picks up env tweaks without a manual restart.
    envWatchPlugin(),
  ],
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
