import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/container.ts',
    'src/decorators.ts',
    'src/app-module.ts',
    'src/adapter.ts',
    'src/logger.ts',
    'src/errors.ts',
    'src/interfaces.ts',
  ],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: true,
  shims: false,
  minify: false,
})
