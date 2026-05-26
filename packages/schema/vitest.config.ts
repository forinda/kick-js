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
      '@forinda/kickjs-schema': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  ssr: {
    noExternal: ['valibot', '@valibot/to-json-schema'],
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
    server: {
      deps: {
        inline: ['valibot', '@valibot/to-json-schema'],
      },
    },
  },
})
