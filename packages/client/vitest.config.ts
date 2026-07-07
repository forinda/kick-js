import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    // Default typecheck.include only matches *.test-d.ts — which silently
    // skipped every expectTypeOf/@ts-expect-error in the real suites.
    typecheck: {
      tsconfig: './tsconfig.test.json',
      include: ['__tests__/**/*.test.ts'],
    },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
  },
})
