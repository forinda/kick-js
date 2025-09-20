import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node18',
    sourcemap: true,
    clean: true,
    dts: true,
    shims: false,
    minify: false,
    external: ['ts-node/register']
  },
  {
    entry: ['src/cli/cli.ts'],
    format: ['cjs'],
    target: 'node18',
    sourcemap: true,
    clean: false,
    dts: false,
    shims: false,
    minify: false,
    banner: {
      js: '#!/usr/bin/env node'
    },
    external: ['ts-node/register']
  }
]);
