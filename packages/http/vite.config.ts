import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        application: resolve(__dirname, 'src/application.ts'),
        bootstrap: resolve(__dirname, 'src/bootstrap.ts'),
        context: resolve(__dirname, 'src/context.ts'),
        'router-builder': resolve(__dirname, 'src/router-builder.ts'),
        'middleware/csrf': resolve(__dirname, 'src/middleware/csrf.ts'),
        'middleware/rate-limit': resolve(__dirname, 'src/middleware/rate-limit.ts'),
        'middleware/session': resolve(__dirname, 'src/middleware/session.ts'),
        'middleware/upload': resolve(__dirname, 'src/middleware/upload.ts'),
        'middleware/validate': resolve(__dirname, 'src/middleware/validate.ts'),
        'middleware/request-id': resolve(__dirname, 'src/middleware/request-id.ts'),
        'middleware/error-handler': resolve(__dirname, 'src/middleware/error-handler.ts'),
        'middleware/views': resolve(__dirname, 'src/middleware/views.ts'),
        'middleware/spa': resolve(__dirname, 'src/middleware/spa.ts'),
        'middleware/request-logger': resolve(__dirname, 'src/middleware/request-logger.ts'),
        'query/index': resolve(__dirname, 'src/query/index.ts'),
      },
      formats: ['es'],
    },
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      external: [
        '@forinda/kickjs-core',
        'reflect-metadata',
        'express',
        'multer',
        'cookie-parser',
        /^node:/,
      ],
    },
  },
})
