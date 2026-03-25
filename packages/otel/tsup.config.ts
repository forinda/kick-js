import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: false,
  clean: true,
  dts: true,
  shims: false,
  minify: true,
  external: [
    '@forinda/kickjs-core',
    '@forinda/kickjs-http',
    'reflect-metadata',
    '@opentelemetry/api',
    '@opentelemetry/sdk-node',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/semantic-conventions',
  ],
})
