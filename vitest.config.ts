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
      '@forinda/kickjs-auth': path.resolve(__dirname, 'packages/auth/src/index.ts'),
      '@forinda/kickjs-core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@forinda/kickjs-cron': path.resolve(__dirname, 'packages/cron/src/index.ts'),
      '@forinda/kickjs-http': path.resolve(__dirname, 'packages/http/src/index.ts'),
      '@forinda/kickjs-config': path.resolve(__dirname, 'packages/config/src/index.ts'),
      '@forinda/kickjs-swagger': path.resolve(__dirname, 'packages/swagger/src/index.ts'),
      '@forinda/kickjs-testing': path.resolve(__dirname, 'packages/testing/src/index.ts'),
      '@forinda/kickjs-ws': path.resolve(__dirname, 'packages/ws/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
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
