import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'minimal',
  modules: {
    dir: 'src/modules',
    repo: 'prisma',
    pluralize: true,
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
      name: 'check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify', 'ci'],
    },
  ],
})
