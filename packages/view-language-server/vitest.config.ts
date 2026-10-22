import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const view = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../view/package.json'), 'utf8'),
)

export default defineConfig({
  define: { __KICK_VIEW_VERSION__: JSON.stringify(view.version) },
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
