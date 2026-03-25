import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    sourcemap: false,
    clean: true,
    dts: true,
    shims: false,
    minify: true,
    external: ['commander'],
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node20',
    sourcemap: false,
    clean: false,
    dts: false,
    shims: false,
    minify: true,
    external: ['commander'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
