import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    pg: 'src/dsl/columns/pg.ts',
  },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: ['@forinda/kickjs', 'kysely', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
