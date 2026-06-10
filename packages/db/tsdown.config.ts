import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    pg: 'src/pg.ts',
    sqlite: 'src/sqlite.ts',
    mysql: 'src/mysql.ts',
    'devtools-events': 'src/devtools-events.ts',
  },
  format: ['esm'],
  platform: 'node',
  minify: { compress: true, mangle: false },
  dts: { tsgo: true },
  external: [
    '@forinda/kickjs',
    '@forinda/kickjs-devtools-kit',
    '@forinda/kickjs-devtools-kit/bus',
    'kysely',
    // Optional driver peers — bundled only into the subpath that needs
    // them, never the core entry, and resolved from the adopter's install.
    'pg',
    'better-sqlite3',
    'mysql2',
    'mysql2/promise',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
