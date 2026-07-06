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
    typecheck: { tsconfig: './tsconfig.test.json' },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
  },
})
