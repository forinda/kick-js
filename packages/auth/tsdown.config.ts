import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: [
    '@forinda/kickjs',
    'reflect-metadata',
    'jsonwebtoken',
    'argon2',
    'bcryptjs',
    'bcrypt',
    /^node:/,
  ],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
