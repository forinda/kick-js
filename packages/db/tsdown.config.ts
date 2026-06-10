import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    pg: 'src/pg.ts',
    sqlite: 'src/sqlite.ts',
    mysql: 'src/mysql.ts',
    cli: 'src/cli.ts',
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
    // CLI subpath deps — kept external so the `./cli` entry + bin resolve
    // them from the install, never bundled into the ORM entries.
    '@forinda/kickjs-cli-kit',
    'commander',
    'jiti',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
