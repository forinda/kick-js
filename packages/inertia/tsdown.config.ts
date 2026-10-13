import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  // Unminified: the minifier strips the `/* @vite-ignore */` hint on the SSR bundle import.
  minify: false,
  dts: true,
  external: ['@forinda/kickjs', /^@forinda\/kickjs\//, /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
