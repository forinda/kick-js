import { defineConfig } from '@forinda/kickjs-cli'

/**
 * `kick.config.ts` controls the CLI's generators and run commands.
 *
 * `pattern` and `modules.repo` shape what `kick g module <name>` produces.
 * `commands` exposes project-specific scripts via `kick <name>`.
 */
export default defineConfig({
  pattern: 'minimal',
  modules: {
    dir: 'src/modules',
    repo: 'inmemory',
    pluralize: true,
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
      name: 'check',
      description: 'Typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify', 'ci'],
    },
  ],
})
