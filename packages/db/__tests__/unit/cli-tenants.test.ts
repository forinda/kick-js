/** `kick db migrate latest --tenants`: every tenant through migrateTenants, failures reported. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Command } from 'commander'
import Database from 'better-sqlite3'
import { generate, reviewMigration } from '@forinda/kickjs-db'
import { registerDbCommands, resolveKickDbConfig } from '../../src/cli'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'
import { writeFile } from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
let dir: string
afterEach(async () => {
  process.exitCode = undefined
  vi.restoreAllMocks()
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('kick db migrate latest --tenants', () => {
  it('migrates each tenant and reports the ones that fail', async () => {
    dir = await mkdtemp(path.join(here, '../fixtures/tmp-cli-tenants-'))
    const schemaPath = path.join(dir, 'schema.ts')
    await writeFile(
      schemaPath,
      `import { serial, table } from '@forinda/kickjs-db'\nexport const t = table('t', { id: serial().primaryKey() })`,
    )
    const migrationsDir = path.join(dir, 'migrations')
    const init = await generate({
      name: 'init',
      config: { schemaPath, migrationsDir, dialect: 'sqlite' },
      cwd: dir,
    })
    await reviewMigration(migrationsDir, path.basename(init.migrationDir!))

    const databases = new Map<string, Database.Database>()
    const config = resolveKickDbConfig({
      schemaPath,
      migrationsDir,
      dialect: 'sqlite',
      tenants: {
        list: () => ['acme', 'broken', 'globex'],
        adapter: (id) => {
          if (id === 'broken') throw new Error('unreachable')
          const database = new Database(':memory:')
          databases.set(id, database)
          return sqliteAdapter({ database })
        },
      },
    })
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line))
    const program = new Command().exitOverride()
    registerDbCommands(program.command('db'), () => config)
    await program.parseAsync(['node', 'kick', 'db', 'migrate', 'latest', '--tenants'])

    expect(lines[0]).toMatch(/^✓ acme: \d+_\d+_init$/)
    expect(lines[1]).toBe('✗ broken: unreachable')
    expect(lines[3]).toBe('2 migrated, 1 failed')
    expect(process.exitCode).toBe(1)
    expect(
      databases.get('globex')!.prepare(`select name from sqlite_master where name = 't'`).get(),
    ).toBeTruthy()
  })
})
