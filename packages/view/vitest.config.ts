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
    alias: {
      '@forinda/kickjs/fastify': path.resolve(
        import.meta.dirname,
        '../kickjs/src/http/runtimes/fastify.ts',
      ),
      '@forinda/kickjs/h3': path.resolve(import.meta.dirname, '../kickjs/src/http/runtimes/h3.ts'),
      '@forinda/kickjs/web': path.resolve(import.meta.dirname, '../kickjs/src/web.ts'),
      '@forinda/kickjs': path.resolve(import.meta.dirname, '../kickjs/src/index.ts'),
      '@forinda/kickjs-view/file-loader': path.resolve(import.meta.dirname, 'src/loaders/file.ts'),
      '@forinda/kickjs-view': path.resolve(import.meta.dirname, 'src/index.ts'),
    },
  },
  test: {
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    pool: 'threads',
  },
})
