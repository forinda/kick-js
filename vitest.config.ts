import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import path from 'node:path'

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@forinda/kickjs-core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@forinda/kickjs-http': path.resolve(__dirname, 'packages/http/src/index.ts'),
      '@forinda/kickjs-config': path.resolve(__dirname, 'packages/config/src/index.ts'),
      '@forinda/kickjs-swagger': path.resolve(__dirname, 'packages/swagger/src/index.ts'),
      '@forinda/kickjs-testing': path.resolve(__dirname, 'packages/testing/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      enabled: false,
    },
  },
})
