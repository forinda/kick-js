/** Seeds, schemas and TypeScript migrations resolve the project's tsconfig path aliases. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSeeds } from '@forinda/kickjs-db'
import { loadModule } from '../../src/cli/load-module'

const here = path.dirname(fileURLToPath(import.meta.url))
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-aliases-'))
  await mkdir(path.join(dir, 'src'))
  await mkdir(path.join(dir, 'db/seeds'), { recursive: true })
  await writeFile(
    path.join(dir, 'tsconfig.json'),
    // A comment and a trailing comma, as tsconfig files often have.
    `{
  // the scaffold's alias
  "compilerOptions": { "paths": { "@/*": ["./src/*"] }, },
}`,
  )
  await writeFile(path.join(dir, 'src/other.ts'), `export const name = 'Ada'`)
  // App code that uses the alias itself, as a seed's imports usually do.
  await writeFile(
    path.join(dir, 'src/client.ts'),
    `import { name } from '@/other'\nexport const seen: string[] = []\nexport const greeting = 'hi ' + name`,
  )
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('path aliases in loaded files', () => {
  it('a seed imports through @/ — and so does what it imports', async () => {
    await writeFile(
      path.join(dir, 'db/seeds/01_greet.ts'),
      `import { greeting, seen } from '@/client'\nexport default async function seed() { seen.push(greeting) }\nexport { seen }`,
    )
    expect(await runSeeds({ dir: path.join(dir, 'db/seeds') })).toEqual({ ran: ['01_greet.ts'] })
    const seed = await loadModule(path.join(dir, 'db/seeds/01_greet.ts'))
    expect(seed.seen).toBeDefined()
  })

  it('a migration.ts imports through @/', async () => {
    await mkdir(path.join(dir, 'db/migrations/1_x'), { recursive: true })
    const file = path.join(dir, 'db/migrations/1_x/migration.ts')
    await writeFile(
      file,
      `import { greeting } from '@/client'\nexport const value = greeting\nexport async function up() {}`,
    )
    expect((await loadModule(file, { fresh: true })).value).toBe('hi Ada')
  })
})
