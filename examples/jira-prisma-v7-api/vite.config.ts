import { defineConfig } from 'vite'
import { resolve } from 'path'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false,
  plugins: [swc.vite(), kickjsVitePlugin({ entry: 'src/index.ts' }), envWatchPlugin()],
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
      external: [/^@prisma\/client/],
    },
  },
})
