import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts'),
      },
      formats: ['es'],
    },
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      external: ['commander', 'vite', /^node:/],
      output: {
        banner: (chunk) =>
          chunk.fileName === 'cli.js' ? '#!/usr/bin/env node' : '',
      },
    },
  },
})
