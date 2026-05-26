import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  minify: { compress: true, mangle: false },
  dts: { tsgo: true },
  external: [
    '@forinda/kickjs',
    '@forinda/kickjs-schema',
    /^@modelcontextprotocol\/sdk/,
    'express',
    'reflect-metadata',
    'zod',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
