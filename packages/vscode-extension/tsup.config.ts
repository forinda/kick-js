import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  target: 'node20',
  sourcemap: false,
  clean: true,
  shims: false,
  minify: true,
  external: ['vscode'],
})
