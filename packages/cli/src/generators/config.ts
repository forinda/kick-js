import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { writeFileSafe } from '../utils/fs'
import { confirm } from '../utils/prompts'

interface GenerateConfigOptions {
  outDir: string
  modulesDir?: string
  defaultRepo?: string
  force?: boolean
}

export async function generateConfig(options: GenerateConfigOptions): Promise<string[]> {
  const filePath = join(options.outDir, 'kick.config.ts')
  const modulesDir = options.modulesDir ?? 'src/modules'
  const defaultRepo = options.defaultRepo ?? 'inmemory'

  if (existsSync(filePath) && !options.force) {
    const overwrite = await confirm({
      message: 'kick.config.ts already exists. Overwrite?',
      initialValue: false,
    })
    if (!overwrite) {
      console.log('\n  Skipped — existing kick.config.ts preserved.')
      return []
    }
  }

  await writeFileSafe(
    filePath,
    `import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  modules: {
    dir: '${modulesDir}',
    repo: '${defaultRepo}',
    pluralize: true,
  },

  typegen: {
    schemaValidator: 'zod',
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
`,
  )

  return [filePath]
}
