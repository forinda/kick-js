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
    'src/reactivity.ts',
    'src/path.ts',
  ],
  format: ['esm'],
  target: 'node20',
  sourcemap: false,
  clean: true,
  dts: true,
  shims: false,
  minify: true,
  external: ['pino', 'pino-pretty', 'reflect-metadata'],
})
