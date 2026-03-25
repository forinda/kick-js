import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  modulesDir: 'src/modules',
  defaultRepo: 'inmemory',

  // Copy static assets to dist/ during `kick build`
  // Vite bundles TS → dist/index.js, but views and public files
  // need to be alongside the bundle for runtime access.
  copyDirs: [
    'views',   // views/ → dist/views/
    'public',  // public/ → dist/public/
  ],

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
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify'],
    },
  ],
})
