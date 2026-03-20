import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  shims: false,
  minify: false,
  external: ['vscode'],
})
