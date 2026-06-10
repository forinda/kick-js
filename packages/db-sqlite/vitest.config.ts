import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import path from 'node:path'

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: {
      '@forinda/kickjs': path.resolve(__dirname, '../kickjs/src/index.ts'),
      '@forinda/kickjs-db/pg': path.resolve(__dirname, '../db/src/pg.ts'),
      '@forinda/kickjs-db/sqlite': path.resolve(__dirname, '../db/src/sqlite.ts'),
      '@forinda/kickjs-db/mysql': path.resolve(__dirname, '../db/src/mysql.ts'),
      '@forinda/kickjs-db': path.resolve(__dirname, '../db/src/index.ts'),
      '@forinda/kickjs-db-sqlite': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    typecheck: { tsconfig: './tsconfig.test.json' },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    pool: 'threads',
    maxConcurrency: 1,
    testTimeout: 90_000,
  },
})
