type ProjectTemplate = 'rest' | 'minimal'
export type ProjectRuntime = 'express' | 'fastify' | 'h3'

/** Generate kick.config.ts CLI configuration */
export function generateKickConfig(
  template: ProjectTemplate,
  defaultRepo: string = 'inmemory',
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' = 'pnpm',
  runtime: 'express' | 'fastify' | 'h3' = 'express',
  /** Emit the client route map — set for scaffolds whose frontend reads it. */
  withClientMap = false,
): string {
  // `inmemory` is the only built-in; every other name (incl. the
  // deprecated prisma/drizzle) is emitted as a `{ name }` custom repo.
  const repoValue = defaultRepo === 'inmemory' ? `'inmemory'` : `{ name: '${defaultRepo}' }`

  return `import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: '${template}',
  // The HTTP engine this app boots on (matches \`bootstrap({ runtime })\` in
  // src/index.ts). Dep-aware commands read it: \`kick add upload\` installs the
  // engine's multipart driver, \`kick doctor\` checks the engine peers, and
  // \`kick typegen\` flips the runtime escape-hatch types to this engine.
  runtime: '${runtime}',
  // Pinned so \`kick add\` and other dep-installing commands always use the
  // project's intended package manager, regardless of which lockfile exists.
  packageManager: '${packageManager}',
  modules: {
    dir: 'src/modules',
    repo: ${repoValue},
    pluralize: true,
  },

  // \`kick typegen\` populates \`.kickjs/types/\` so \`Ctx<KickRoutes.X['method']>\`
  // resolves to fully-typed params/body/query. Auto-runs on \`kick dev\`.
  // \`'kickjs-schema'\` routes inference through \`InferSchemaOutput\` so the
  // typegen works for any wrapped schema (Zod / Valibot / Yup). Switch
  // to \`'zod'\` if you ship Zod schemas without \`fromZod()\` wrapping, or
  // set \`schemaValidator: false\` to skip schema-driven body typing.
  typegen: {
    schemaValidator: 'kickjs-schema',${
      withClientMap
        ? `
    // web/ reads this map from the ambient KickClientApi namespace. Producing
    // it builds a TypeScript program over the server, so it stays off unless a
    // project actually consumes it.
    client: true,`
        : ''
    }
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
`
}
