import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)
const view = readPkg(`${import.meta.dirname}/../view`)

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  dts: true,
  define: { __KICK_VIEW_VERSION__: JSON.stringify(view.version) },
  external: [/^@volar\//, /^volar-service-/, 'vscode-uri', '@forinda/kickjs-view', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
