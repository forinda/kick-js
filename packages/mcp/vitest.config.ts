import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import path from 'node:path'

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: [
      // Runtime subpaths first: a bare '@forinda/kickjs' entry would also
      // rewrite '@forinda/kickjs/fastify' to a path under index.ts.
      {
        find: /^@forinda\/kickjs\/fastify$/,
        replacement: path.resolve(import.meta.dirname, '../kickjs/src/http/runtimes/fastify.ts'),
      },
      {
        find: /^@forinda\/kickjs\/h3-web$/,
        replacement: path.resolve(import.meta.dirname, '../kickjs/src/http/runtimes/h3-web.ts'),
      },
      // h3 v2, installed for the kickjs runtime tests.
      {
        find: /^h3-v2$/,
        replacement: path.resolve(import.meta.dirname, '../kickjs/node_modules/h3-v2'),
      },
      {
        find: /^@forinda\/kickjs$/,
        replacement: path.resolve(import.meta.dirname, '../kickjs/src/index.ts'),
      },
      {
        find: /^@forinda\/kickjs-mcp$/,
        replacement: path.resolve(import.meta.dirname, 'src/index.ts'),
      },
    ],
  },
  test: {
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    pool: 'threads',
    maxConcurrency: 1,
  },
})
