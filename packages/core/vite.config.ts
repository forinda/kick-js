import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        container: resolve(__dirname, 'src/container.ts'),
        decorators: resolve(__dirname, 'src/decorators.ts'),
        'app-module': resolve(__dirname, 'src/app-module.ts'),
        adapter: resolve(__dirname, 'src/adapter.ts'),
        logger: resolve(__dirname, 'src/logger.ts'),
        errors: resolve(__dirname, 'src/errors.ts'),
        interfaces: resolve(__dirname, 'src/interfaces.ts'),
        reactivity: resolve(__dirname, 'src/reactivity.ts'),
        path: resolve(__dirname, 'src/path.ts'),
      },
      formats: ['es'],
    },
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      external: ['pino', 'pino-pretty', 'reflect-metadata', /^node:/],
    },
  },
})
