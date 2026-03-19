import { defineConfig } from '@forinda/kickjs-cli'

/**
 * Project-level CLI configuration.
 *
 * Custom commands extend the `kick` CLI so the whole team uses
 * consistent tooling. Add Drizzle, protobuf, or any tool here.
 *
 * Run `kick --help` to see all available commands including custom ones.
 */
export default defineConfig({
  modulesDir: 'src/modules',
  defaultRepo: 'inmemory',

  commands: [
    // ── Database (Drizzle) ────────────────────────────────────────────
    {
      name: 'db:generate',
      description: 'Generate Drizzle migrations from schema',
      steps: 'npx drizzle-kit generate',
      aliases: ['migrate:gen'],
    },
    {
      name: 'db:migrate',
      description: 'Run database migrations',
      steps: 'npx drizzle-kit migrate',
    },
    {
      name: 'db:push',
      description: 'Push schema directly (dev only)',
      steps: 'npx drizzle-kit push',
    },
    {
      name: 'db:studio',
      description: 'Open Drizzle Studio GUI',
      steps: 'npx drizzle-kit studio',
    },
    {
      name: 'db:seed',
      description: 'Run database seed files',
      steps: 'npx tsx src/db/seed.ts',
    },

    // ── Code quality ──────────────────────────────────────────────────
    {
      name: 'lint',
      description: 'Run ESLint on source files',
      steps: 'npx eslint src/',
    },
    {
      name: 'format',
      description: 'Format code with Prettier',
      steps: 'npx prettier --write src/',
    },
    {
      name: 'format:check',
      description: 'Check formatting without writing',
      steps: 'npx prettier --check src/',
    },
    {
      name: 'test',
      description: 'Run tests with Vitest',
      steps: 'npx vitest run',
    },
    {
      name: 'test:watch',
      description: 'Run tests in watch mode',
      steps: 'npx vitest',
    },

    // ── Combined checks ───────────────────────────────────────────────
    {
      name: 'check',
      description: 'Run typecheck + lint + format check',
      steps: [
        'npx tsc --noEmit',
        'npx eslint src/',
        'npx prettier --check src/',
      ],
      aliases: ['verify', 'ci'],
    },
  ],
})
