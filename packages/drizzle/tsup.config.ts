import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: false,
  clean: true,
  dts: true,
  shims: false,
  minify: true,
  external: ['@forinda/kickjs-core', '@forinda/kickjs-http', 'reflect-metadata', 'drizzle-orm'],
})
