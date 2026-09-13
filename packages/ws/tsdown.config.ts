import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    redis: 'src/redis.ts',
    'socket-io': 'src/socket-io.ts',
  },
  format: ['esm'],
  platform: 'node',
  minify: { compress: true, mangle: false },
  dts: true,
  external: [
    '@forinda/kickjs',
    'reflect-metadata',
    'ws',
    'socket.io',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
