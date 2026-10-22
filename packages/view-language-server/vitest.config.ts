import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@forinda/kickjs-view': path.resolve(import.meta.dirname, '../view/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    pool: 'forks',
  },
})
