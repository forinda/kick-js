import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/application.ts',
    'src/bootstrap.ts',
    'src/context.ts',
    'src/router-builder.ts',
    'src/middleware/csrf.ts',
    'src/middleware/upload.ts',
    'src/middleware/validate.ts',
    'src/middleware/request-id.ts',
    'src/middleware/error-handler.ts',
    'src/query/index.ts',
  ],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: true,
  shims: false,
  minify: false,
  external: ['@kickjs/core', 'reflect-metadata'],
})
