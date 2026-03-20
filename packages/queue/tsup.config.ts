import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: true,
  shims: false,
  minify: false,
  external: ['@forinda/kickjs-core', 'reflect-metadata', 'bullmq', 'ioredis', 'amqplib', 'kafkajs'],
})
