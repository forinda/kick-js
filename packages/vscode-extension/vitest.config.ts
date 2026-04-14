import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    alias: {
      vscode: resolve(__dirname, '__tests__/__mocks__/vscode.ts'),
    },
  },
})
