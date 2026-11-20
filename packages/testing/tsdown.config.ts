import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vitest: 'src/vitest.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  platform: 'node',
  minify: { compress: true, mangle: false },
  dts: true,
  external: [
    '@forinda/kickjs',
    'express',
    'reflect-metadata',
    'supertest',
    'vitest',
    'testcontainers',
    '@forinda/kickjs-cli-kit',
    'commander',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
