import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    zod: 'src/adapters/zod.ts',
    valibot: 'src/adapters/valibot.ts',
    yup: 'src/adapters/yup.ts',
  },
  format: ['esm'],
  platform: 'node',
  minify: { compress: true, mangle: false },
  dts: { tsgo: true },
  external: ['valibot', '@valibot/to-json-schema', 'yup', 'zod', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
