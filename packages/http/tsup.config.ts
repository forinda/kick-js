import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/application.ts',
    'src/bootstrap.ts',
    'src/context.ts',
    'src/router-builder.ts',
    'src/middleware/csrf.ts',
    'src/middleware/rate-limit.ts',
    'src/middleware/session.ts',
    'src/middleware/upload.ts',
    'src/middleware/validate.ts',
    'src/middleware/request-id.ts',
    'src/middleware/error-handler.ts',
    'src/middleware/views.ts',
    'src/middleware/spa.ts',
    'src/query/index.ts',
  ],
  format: ['esm'],
  target: 'node20',
  sourcemap: false,
  clean: true,
  dts: true,
  shims: false,
  minify: true,
  external: ['@forinda/kickjs-core', 'reflect-metadata', 'express', 'multer', 'cookie-parser'],
})
