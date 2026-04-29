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
      // The `/bus` sub-path must match BEFORE the bare-package alias,
      // otherwise vitest rewrites everything to ../devtools-kit/src/index.ts.
      // Array form preserves declaration order; object form doesn't.
      {
        find: '@forinda/kickjs-devtools-kit/bus',
        replacement: path.resolve(__dirname, '../devtools-kit/src/bus.ts'),
      },
      {
        find: '@forinda/kickjs-devtools-kit',
        replacement: path.resolve(__dirname, '../devtools-kit/src/index.ts'),
      },
      {
        find: '@forinda/kickjs',
        replacement: path.resolve(__dirname, '../kickjs/src/index.ts'),
      },
      {
        find: '@forinda/kickjs-devtools',
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
