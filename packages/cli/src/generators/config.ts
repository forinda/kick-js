import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { writeFileSafe } from '../utils/fs'

interface GenerateConfigOptions {
  outDir: string
  modulesDir?: string
  defaultRepo?: string
  force?: boolean
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`  ${message} (y/N) `, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

export async function generateConfig(options: GenerateConfigOptions): Promise<string[]> {
  const filePath = join(options.outDir, 'kick.config.ts')
  const modulesDir = options.modulesDir ?? 'src/modules'
  const defaultRepo = options.defaultRepo ?? 'inmemory'

  if (existsSync(filePath) && !options.force) {
    const overwrite = await confirm('kick.config.ts already exists. Overwrite?')
    if (!overwrite) {
      console.log('\n  Skipped — existing kick.config.ts preserved.')
      return []
    }
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
