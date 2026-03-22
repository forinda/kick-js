import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'ddd',
  modulesDir: 'src/modules',
  defaultRepo: 'drizzle',

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
      name: 'check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify', 'ci'],
    },
    {
      name: 'seed',
      description: 'Seed database with sample data',
      steps: 'npx tsx src/db/seed.ts',
    },
    {
      name: 'db:reset',
      description: 'Truncate all tables and reseed',
      steps: ['npx tsx src/db/reset.ts', 'npx tsx src/db/seed.ts'],
    },
    {
      name: 'db:migrate',
      description: 'Push schema changes to database',
      steps: 'npx drizzle-kit push',
    },
  ],
})
