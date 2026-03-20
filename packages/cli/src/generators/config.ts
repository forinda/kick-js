import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { writeFileSafe } from '../utils/fs'

interface GenerateConfigOptions {
  outDir: string
  modulesDir?: string
  defaultRepo?: string
}

export async function generateConfig(options: GenerateConfigOptions): Promise<string[]> {
  const filePath = join(options.outDir, 'kick.config.ts')
  const modulesDir = options.modulesDir ?? 'src/modules'
  const defaultRepo = options.defaultRepo ?? 'inmemory'

  if (existsSync(filePath)) {
    console.log('\n  kick.config.ts already exists — skipping to avoid overwriting.')
    return []
  }

  await writeFileSafe(
    filePath,
    `import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  modulesDir: '${modulesDir}',
  defaultRepo: '${defaultRepo}',

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
`,
  )

  return [filePath]
}
