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
    alias: [
      // Array form preserves order — more-specific subpaths must match
      // BEFORE the bare-package alias.
      {
        find: '@forinda/kickjs-devtools-kit/bus',
        replacement: path.resolve(__dirname, '../devtools-kit/src/bus.ts'),
      },
      {
        find: '@forinda/kickjs-devtools-kit',
        replacement: path.resolve(__dirname, '../devtools-kit/src/index.ts'),
      },
      {
        find: '@forinda/kickjs-db/devtools-events',
        replacement: path.resolve(__dirname, 'src/devtools-events.ts'),
      },
      {
        find: '@forinda/kickjs-db/pg',
        replacement: path.resolve(__dirname, 'src/dsl/columns/pg.ts'),
      },
      // M5.B — internal-only alias so tests can reach the ALTER TYPE
      // helpers that aren't part of the public `package.json` exports.
      {
        find: '@forinda/kickjs-db/emit/alter-type',
        replacement: path.resolve(__dirname, 'src/emit/alter-type.ts'),
      },
      {
        find: '@forinda/kickjs-db',
        replacement: path.resolve(__dirname, 'src/index.ts'),
      },
      {
        find: '@forinda/kickjs',
        replacement: path.resolve(__dirname, '../kickjs/src/index.ts'),
      },
    ],
  },
  test: {
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    pool: 'threads',
    maxConcurrency: 1,
    testTimeout: 60_000,
  },
})
