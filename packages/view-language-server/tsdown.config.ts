import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: { index: 'src/index.ts', main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  fixedExtension: false,
  dts: true,
  external: [/^@volar\//, /^volar-service-/, 'vscode-uri', '@forinda/kickjs-view', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
