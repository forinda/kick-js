import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  platform: 'node',
  external: ['vite', '@forinda/kickjs-core', 'reflect-metadata', /^node:/],
  banner: {
    js: createBanner(pkg.name, pkg.version),
  },
})
