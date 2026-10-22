import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    edge: 'src/edge.ts',
    'file-loader': 'src/loaders/file.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  minify: { compress: true, mangle: false },
  dts: true,
  external: ['@forinda/kickjs', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
