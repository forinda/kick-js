import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    sourcemap: true,
    clean: true,
    dts: true,
    shims: false,
    minify: false,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node20',
    sourcemap: true,
    clean: false,
    dts: false,
    shims: false,
    minify: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
