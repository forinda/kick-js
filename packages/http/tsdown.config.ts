import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    application: 'src/application.ts',
    bootstrap: 'src/bootstrap.ts',
    context: 'src/context.ts',
    'router-builder': 'src/router-builder.ts',
    'middleware/csrf': 'src/middleware/csrf.ts',
    'middleware/rate-limit': 'src/middleware/rate-limit.ts',
    'middleware/session': 'src/middleware/session.ts',
    'middleware/upload': 'src/middleware/upload.ts',
    'middleware/validate': 'src/middleware/validate.ts',
    'middleware/request-id': 'src/middleware/request-id.ts',
    'middleware/error-handler': 'src/middleware/error-handler.ts',
    'middleware/views': 'src/middleware/views.ts',
    'middleware/spa': 'src/middleware/spa.ts',
    'middleware/request-logger': 'src/middleware/request-logger.ts',
    'middleware/helmet': 'src/middleware/helmet.ts',
    'middleware/cors': 'src/middleware/cors.ts',
    'middleware/request-scope': 'src/middleware/request-scope.ts',
    'request-store': 'src/request-store.ts',
    'query/index': 'src/query/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: [
    '@forinda/kickjs-core',
    'reflect-metadata',
    'express',
    'multer',
    'cookie-parser',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
