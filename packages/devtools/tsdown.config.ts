import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: [
    '@forinda/kickjs',
    '@forinda/kickjs-core',
    '@forinda/kickjs-devtools-kit',
    'reflect-metadata',
    'express',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
