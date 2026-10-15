import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    disk: 'src/disk.ts',
    settings: 'src/settings.ts',
    tus: 'src/tus.ts',
    adapter: 'src/adapter.ts',
  },
  format: ['esm'],
  platform: 'node',
  minify: { compress: true, mangle: false },
  dts: true,
  external: ['@forinda/kickjs', '@forinda/kickjs-schema', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
