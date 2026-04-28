import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'minimal',
  // Pinned so `kick add` and other dep-installing commands always use the
  // project's intended package manager, regardless of which lockfile exists.
  packageManager: 'pnpm',
  modules: {
    dir: 'src/modules',
    repo: 'inmemory',
    pluralize: true,
  },

  // @forinda/kickjs-db config for the CLI (kick db generate / migrate /
  // introspect). The runtime client is constructed in src/db/client.ts and
  // wired through kickDbAdapter in src/index.ts; the CLI uses connectionString
  // (or DATABASE_URL env) to spin up its own pgAdapter for migration ops.
  db: {
    // Folder + barrel — explicit `/index.ts` so Node's ESM loader picks
    // up the file (directory imports don't auto-resolve under ESM).
    schemaPath: 'src/db/schema/index.ts',
    migrationsDir: 'db/migrations',
    dialect: 'postgres' as const,
  },

  // `kick typegen` populates `.kickjs/types/` so `Ctx<KickRoutes.X['method']>`
  // resolves to fully-typed params/body/query. Auto-runs on `kick dev`.
  // Set `schemaValidator: false` to skip schema-driven body typing entirely.
  typegen: {
    schemaValidator: 'zod',
  },

  commands: [
    {
      name: 'test',
      description: 'Run tests with Vitest',
      steps: 'npx vitest run',
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
      name: 'ci:check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify'],
    },
  ],
})
