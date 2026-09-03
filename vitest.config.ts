import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import path from 'node:path'

/**
 * Root Vitest config.
 *
 * This file defines **projects**, it does not run package tests itself. That
 * distinction matters: several suites resolve paths against `process.cwd()`
 * (the asset-manifest probes, the `.env` layering tests), so running them from
 * the repo root produced ~120 failures that CI never saw — CI runs
 * `turbo run test`, which invokes each package's own Vitest with the package as
 * the working directory.
 *
 * With `projects`, a bare `vitest` at the root gives every package its own root
 * and config, matching CI. `pnpm test` (turbo) stays the canonical command —
 * it also builds first, which the `dts-consumer-emit` suite needs.
 */
export default defineConfig({
  test: {
    projects: [
      // Each package brings its own config: correct root, its own aliases, and
      // in kickjs's case a typecheck include list. Globbing the config files
      // rather than the directories keeps packages without a suite out.
      'packages/*/vitest.config.ts',

      // Cross-package integration tests live at the repo root and resolve
      // workspace packages to source through the aliases below.
      {
        plugins: [
          swc.vite({
            jsc: {
              parser: { syntax: 'typescript', decorators: true },
              transform: {
                legacyDecorator: true,
                decoratorMetadata: true,
              },
            },
          }),
        ],
        resolve: {
          alias: {
            '@forinda/kickjs': path.resolve(__dirname, 'packages/kickjs/src/index.ts'),
            '@forinda/kickjs-mailer': path.resolve(__dirname, 'packages/mailer/src/index.ts'),
            '@forinda/kickjs-core': path.resolve(__dirname, 'packages/kickjs/src/core/index.ts'),
            '@forinda/kickjs-cron': path.resolve(__dirname, 'packages/cron/src/index.ts'),
            '@forinda/kickjs-http': path.resolve(__dirname, 'packages/kickjs/src/index.ts'),
            '@forinda/kickjs-config': path.resolve(__dirname, 'packages/config/src/index.ts'),
            '@forinda/kickjs-swagger': path.resolve(__dirname, 'packages/swagger/src/index.ts'),
            '@forinda/kickjs-testing': path.resolve(__dirname, 'packages/testing/src/index.ts'),
            '@forinda/kickjs-ws': path.resolve(__dirname, 'packages/ws/src/index.ts'),
            '@forinda/kickjs-devtools': path.resolve(__dirname, 'packages/devtools/src/index.ts'),
            '@forinda/kickjs-queue': path.resolve(__dirname, 'packages/queue/src/index.ts'),
          },
        },
        test: {
          name: 'root',
          root: __dirname,
          environment: 'node',
          globals: false,
          // Root-owned suites only. Package suites belong to their own project
          // above; listing `packages/*/__tests__` here is what ran them with
          // the wrong working directory.
          include: ['__tests__/**/*.test.ts'],
          typecheck: {
            tsconfig: './tsconfig.test.json',
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      enabled: false,
    },
  },
})
