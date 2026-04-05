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
      '@forinda/kickjs': path.resolve(__dirname, '../kickjs/src/index.ts'),
      '@forinda/kickjs-mailer': path.resolve(__dirname, 'src/index.ts'),
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
    maxConcurrency: 1,
    server: {
      deps: {
        // nodemailer is CJS-only. On Node 24 + Vitest 4 the stricter
        // CJS/ESM boundary enforcement causes a V8 FATAL ERROR when
        // Vitest tries to transform it. Externalising keeps the
        // original CJS module and avoids the crash.
        external: [/nodemailer/],
      },
    },
  },
})
