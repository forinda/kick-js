import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      external: [
        '@forinda/kickjs-core',
        '@forinda/kickjs-http',
        'reflect-metadata',
        '@prisma/client',        /^node:/,
      ],
    },
  },
})
