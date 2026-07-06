import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  // Neutral platform: the client runs in browsers, node, and edge — zero
  // node APIs, zero dependencies, fetch/URL/Headers only.
  platform: 'neutral',
  minify: { compress: true, mangle: false },
  dts: { tsgo: true },
  external: [],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
