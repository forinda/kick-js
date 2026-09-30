import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: '{{template}}',
  // The HTTP engine this app boots on (matches `bootstrap({ runtime })` in
  // src/index.ts). Dep-aware commands read it: `kick add upload` installs the
  // engine's multipart driver, `kick doctor` checks the engine peers, and
  // `kick typegen` flips the runtime escape-hatch types to this engine.
  runtime: '{{runtime}}',
  // Pinned so `kick add` and other dep-installing commands always use the
  // project's intended package manager, regardless of which lockfile exists.
  packageManager: '{{packageManager}}',
  modules: {
    dir: 'src/modules',
    // @kick:repo
    pluralize: true,
  },

  // `kick typegen` populates `.kickjs/types/` so `Ctx<KickRoutes.X['method']>`
  // resolves to fully-typed params/body/query. Auto-runs on `kick dev`.
  // `'kickjs-schema'` routes inference through `InferSchemaOutput` so the
  // typegen works for any wrapped schema (Zod / Valibot / Yup). Switch
  // to `'zod'` if you ship Zod schemas without `fromZod()` wrapping, or
  // set `schemaValidator: false` to skip schema-driven body typing.
  typegen: {
    schemaValidator: 'kickjs-schema',
    // @kick:typegen-option
  },

  commands: [
    {
      name: 'test',
      description: 'Run tests with Vitest',
      steps: 'vitest run',
    },
    {
      name: 'lint',
      description: 'Lint with oxlint',
      steps: 'oxlint src/',
    },
    {
      name: 'format',
      description: 'Format code with oxfmt',
      steps: 'oxfmt src/',
    },
    {
      name: 'format:check',
      description: 'Check formatting without writing',
      steps: 'oxfmt --check src/',
    },
    {
      name: 'ci:check',
      description: 'Run typecheck + lint + format check',
      steps: ['kick typecheck', 'oxlint src/', 'oxfmt --check src/'],
      aliases: ['verify'],
    },
  ],
})
