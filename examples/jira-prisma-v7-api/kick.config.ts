import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'ddd',
  modules: {
    dir: 'src/modules',
    repo: 'prisma',
    prismaClientPath: '@/generated/prisma/client',
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
      name: 'check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify', 'ci'],
    },
    {
      name: 'seed',
      description: 'Seed database with sample data',
      steps: 'npx prisma db seed',
    },
    {
      name: 'db:reset',
      description: 'Reset database and reseed',
      steps: 'npx prisma migrate reset --force',
    },
    {
      name: 'db:migrate',
      description: 'Push schema changes to database',
      steps: 'npx prisma db push',
    },
    {
      name: 'db:generate',
      description: 'Generate Prisma client',
      steps: 'npx prisma generate',
    },
  ],
})
