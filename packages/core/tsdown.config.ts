import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    container: 'src/container.ts',
    decorators: 'src/decorators.ts',
    'app-module': 'src/app-module.ts',
    adapter: 'src/adapter.ts',
    logger: 'src/logger.ts',
    errors: 'src/errors.ts',
    interfaces: 'src/interfaces.ts',
    reactivity: 'src/reactivity.ts',
    path: 'src/path.ts',
  },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: ['pino', 'pino-pretty', 'reflect-metadata', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
