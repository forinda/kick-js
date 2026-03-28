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
      '@forinda/kickjs-core': path.resolve(__dirname, '../core/src/index.ts'),
      '@forinda/kickjs-http': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    pool: 'threads',
    maxConcurrency: 1,
  },
})
