import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  sourcemap: true,
  clean: true,
  dts: true,
  shims: false,
  minify: false
});
