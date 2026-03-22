import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'ddd',
  modulesDir: 'src/modules',
  defaultRepo: 'inmemory',

  commands: [
    {
      name: 'seed',
      description: 'Populate database with sample data',
      steps: 'npx vite-node src/db/seed.ts',
    },
    {
      name: 'db:reset',
      description: 'Drop database and reseed',
      steps: ['npx vite-node src/db/reset.ts', 'npx vite-node src/db/seed.ts'],
    },
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
  ],
})
