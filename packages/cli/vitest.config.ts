import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * E2E tests for the kick CLI.
 *
 * Each test spawns the built `dist/cli.mjs` binary against a temp
 * fixture project, runs `npx tsc --noEmit` against the generated
 * files, and asserts on the result. The suite catches the bugs we
 * just fixed (broken module shape, missing register method) without
 * needing per-template snapshots.
 *
 * The CLI dist must be built before running tests — `pnpm build`
 * in the CLI package handles this. Tests run sequentially because
 * each one spawns subprocesses and writes to the filesystem.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@forinda/kickjs': path.resolve(__dirname, '../kickjs/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    // CLI tests spawn subprocesses, write to disk, and run tsc — they
    // are expensive and must not run in parallel. fileParallelism: false
    // ensures one test file at a time.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
})
