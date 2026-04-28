import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)
const banner = createBanner(pkg.name, pkg.version)

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm'],
    platform: 'node',
    dts: true,
    external: [
      '@forinda/kickjs-ai',
      '@forinda/kickjs-db',
      '@forinda/kickjs-db-pg',
      '@clack/prompts',
      'picocolors',
      'commander',
      'pg',
      'pluralize',
      'vite',
      /^node:/,
    ],
    banner: { js: banner },
  },
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    platform: 'node',
    dts: false,
    external: [
      '@forinda/kickjs-ai',
      '@forinda/kickjs-db',
      '@forinda/kickjs-db-pg',
      '@clack/prompts',
      'picocolors',
      'commander',
      'pg',
      'pluralize',
      'vite',
      /^node:/,
    ],
    banner: { js: banner },
  },
])
