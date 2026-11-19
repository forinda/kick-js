/** `kick db --config <file>` / KICK_DB_CONFIG: a named db config replaces kick.config's `db` block. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import {
  configFileOf,
  loadDbConfigFile,
  registerDbCommands,
  resolveKickDbConfig,
} from '../../src/cli'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kick-db-config-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  delete process.env.KICK_DB_CONFIG
  await rm(dir, { recursive: true, force: true })
})

const file = async (name: string, text: string) => {
  const p = path.join(dir, name)
  await writeFile(p, text)
  return p
}

describe('loadDbConfigFile', () => {
  it('reads .mjs, .json and .ts (with an extensionless sibling import)', async () => {
    expect(
      await loadDbConfigFile(
        await file('a.mjs', "export default { dialect: 'sqlite', migrationsDir: 'm' }"),
      ),
    ).toEqual({ dialect: 'sqlite', migrationsDir: 'm' })
    expect(await loadDbConfigFile(await file('b.json', '{ "migrationsDir": "j" }'))).toEqual({
      migrationsDir: 'j',
    })
    await file('base.ts', "export const base = { migrationsDir: 'shared' as string }")
    const ts = await file(
      'staging.ts',
      "import { base } from './base'\nexport default { ...base, dialect: 'sqlite' }",
    )
    expect(await loadDbConfigFile(ts)).toEqual({ migrationsDir: 'shared', dialect: 'sqlite' })
  })

  it("takes a kick.config-style file's db block", async () => {
    const p = await file(
      'kick.staging.config.mjs',
      "export default { db: { migrationsDir: 'from-db' } }",
    )
    expect(await loadDbConfigFile(p)).toEqual({ migrationsDir: 'from-db' })
  })

  it('names the path when the file is missing or exports no config', async () => {
    const missing = path.join(dir, 'nope.ts')
    await expect(loadDbConfigFile(missing)).rejects.toThrow(missing)
    const bad = await file('bad.mjs', 'export default 42')
    await expect(loadDbConfigFile(bad)).rejects.toThrow(bad)
  })
})

describe('configFileOf', () => {
  it('takes the flag, else a non-empty KICK_DB_CONFIG', () => {
    expect(configFileOf({ config: 'a' }, { KICK_DB_CONFIG: 'b' })).toBe('a')
    expect(configFileOf({}, { KICK_DB_CONFIG: 'b' })).toBe('b')
    expect(configFileOf({}, { KICK_DB_CONFIG: '' })).toBeUndefined()
    expect(configFileOf({}, {})).toBeUndefined()
  })
})

describe('kick db --config', () => {
  // Adapters that throw a marker: which config a command ran with, no database needed.
  const base = () =>
    resolveKickDbConfig({
      dialect: 'sqlite',
      adapter: () => {
        throw new Error('base used')
      },
    })
  const run = async (args: string[]) => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(String(l)))
    const program = new Command().exitOverride()
    registerDbCommands(program.command('db'), base)
    const err = await program.parseAsync(['node', 'kick', 'db', ...args]).then(
      () => undefined,
      (e: Error) => e,
    )
    return { lines, err }
  }
  const fileConfig = () =>
    file(
      'staging.mjs',
      "export default { dialect: 'sqlite', adapter: () => { throw new Error('file used') } }",
    )

  it('runs with the named file instead, after or before the subcommand, and says so', async () => {
    const p = await fileConfig()
    const after = await run(['migrate', 'status', '--config', p])
    expect(after.err?.message).toBe('file used')
    expect(after.lines[0]).toBe(`db config: ${p}`)
    const before = await run(['--config', p, 'migrate', 'status'])
    expect(before.err?.message).toBe('file used')
  })

  it('never falls back to the base adapter when the file only sets a connection', async () => {
    const p = await file(
      'pg.mjs',
      "export default { connectionString: 'postgres://127.0.0.1:1/none' }",
    )
    const r = await run(['migrate', 'status', '-c', p])
    expect(r.err?.message).not.toBe('base used')
  })

  it('reads KICK_DB_CONFIG, and the base config without either', async () => {
    process.env.KICK_DB_CONFIG = await fileConfig()
    expect((await run(['migrate', 'status'])).err?.message).toBe('file used')
    delete process.env.KICK_DB_CONFIG
    const plain = await run(['migrate', 'status'])
    expect(plain.err?.message).toBe('base used')
    expect(plain.lines).toEqual([])
  })

  it('resolves a relative path from the working directory', async () => {
    const p = await fileConfig()
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir)
    const r = await run(['migrate', 'status', '--config', path.basename(p)])
    cwd.mockRestore()
    expect(r.err?.message).toBe('file used')
  })
})
