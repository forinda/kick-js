import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  minify: { compress: true, mangle: false },
  dts: true,
  external: ['reflect-metadata'],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
