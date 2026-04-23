import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    runtime: 'src/runtime.ts',
    types: 'src/types.ts',
  },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: [/^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
