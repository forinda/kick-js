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
    globalName: 'kickjs',
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
    globalName: 'kickjsCli',
    banner: {
      js: '#!/usr/bin/env node'
    },
    external: ['ts-node/register']
  }
]);
