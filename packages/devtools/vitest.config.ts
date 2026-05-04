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
      // Anchored regex aliases — string `find` does prefix matching,
      // which rewrites `/bus/token` into `bus.ts/token` (ENOTDIR).
      // Order still matters: longest subpath first.
      {
        find: /^@forinda\/kickjs-devtools-kit\/bus\/token$/,
        replacement: path.resolve(__dirname, '../devtools-kit/src/bus/token.ts'),
      },
      {
        find: /^@forinda\/kickjs-devtools-kit\/bus$/,
        replacement: path.resolve(__dirname, '../devtools-kit/src/bus.ts'),
      },
      {
        find: /^@forinda\/kickjs-devtools-kit$/,
        replacement: path.resolve(__dirname, '../devtools-kit/src/index.ts'),
      },
      {
        find: /^@forinda\/kickjs$/,
        replacement: path.resolve(__dirname, '../kickjs/src/index.ts'),
      },
      {
        find: /^@forinda\/kickjs-devtools$/,
        replacement: path.resolve(__dirname, 'src/index.ts'),
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
  },
})
