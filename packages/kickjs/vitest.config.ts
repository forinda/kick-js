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
      '@forinda/kickjs': path.resolve(__dirname, 'src/index.ts'),
      '@forinda/kickjs-testing': path.resolve(__dirname, '../testing/src/index.ts'),
    },
  },
  test: {
    typecheck: {
      tsconfig: './tsconfig.test.json',
      // Default include only matches *.test-d.ts — without this the
      // expectTypeOf suite below was never actually type-checked.
      include: ['**/infer-handler-response.test.ts', '**/context-required-params.test.ts'],
    },
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '**/__tests__/**/*.test.ts','**/*.test.ts'],
    globals: false,
  },
})
