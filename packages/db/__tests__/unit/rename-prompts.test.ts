/**
 * D.17 rename prompts: drops that might be renames are asked about (or named
 * with flags) instead of silently losing the data.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diff,
  extractSnapshot,
  findRenameCandidates,
  generate,
  integer,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { askRenamesInTerminal, parseRenameFlags } from '../../src/cli/renames'

const before = {
  users: table('users', { id: serial().primaryKey(), fullName: text(), nickname: text() }),
}
const after = {
  people: table('people', {
    id: serial().primaryKey(),
    displayName: varchar(200),
    bio: text(),
    age: integer(),
  }),
}
const prev = extractSnapshot(before, 'postgres')
const next = extractSnapshot(after, 'postgres')

describe('rename hints in diff', () => {
  it('renames a table and a column, altering the column it renamed', () => {
    const changes = diff(prev, next, {
      renames: { tables: { users: 'people' }, columns: { 'people.fullName': 'displayName' } },
      explicitRenames: true,
    })
    expect(changes.map((c) => c.kind)).toEqual([
      'renameTable',
      'renameColumn',
      'dropColumn',
      'addColumn',
      'addColumn',
      'alterColumn',
    ])
    expect(changes[1]).toMatchObject({ table: 'people', from: 'fullName', to: 'displayName' })
    expect(changes[5]).toMatchObject({ column: 'displayName', after: { type: 'varchar(200)' } })
  })

  it('without hints, a dropped table is dropped', () => {
    expect(diff(prev, next).map((c) => c.kind)).toEqual(['dropTable', 'createTable'])
  })

  it('refuses a hint that names a table or column the diff did not lose or gain', () => {
    expect(() => diff(prev, next, { renames: { tables: { users: 'nope' } } })).toThrow(
      /cannot rename table users to nope/,
    )
    expect(() =>
      diff(prev, next, {
        renames: { tables: { users: 'people' }, columns: { 'people.id': 'bio' } },
      }),
    ).toThrow(/cannot rename people.id to bio/)
  })

  it('explicitRenames turns off the one-drop-one-add guess', () => {
    const a = extractSnapshot({ t: table('t', { id: serial().primaryKey(), a: text() }) }, 'sqlite')
    const b = extractSnapshot({ t: table('t', { id: serial().primaryKey(), b: text() }) }, 'sqlite')
    expect(diff(a, b).map((c) => c.kind)).toEqual(['renameColumn'])
    expect(diff(a, b, { explicitRenames: true }).map((c) => c.kind)).toEqual([
      'dropColumn',
      'addColumn',
    ])
  })

  it('lists the candidates', () => {
    expect(findRenameCandidates(prev, next)).toEqual({
      tables: [{ from: 'users', to: ['people'] }],
      columns: [],
    })
  })
})

describe('generate asks about renames', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(here, '../fixtures/tmp-renames-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function setup() {
    const migrationsDir = path.join(dir, 'migrations')
    let clock = Date.UTC(2026, 9, 3, 12, 0, 0)
    const now = () => new Date((clock += 60_000))
    const write = async (file: string, body: string) => {
      await writeFile(
        path.join(dir, file),
        `import { integer, serial, table, text, varchar } from '@forinda/kickjs-db'\n${body}`,
      )
      return { schemaPath: path.join(dir, file), migrationsDir, dialect: 'postgres' as const }
    }
    await generate({
      name: 'init',
      config: await write(
        'v1.ts',
        `export const users = table('users', { id: serial().primaryKey(), fullName: text(), nickname: text() })`,
      ),
      cwd: dir,
      now,
    })
    const v2 = await write(
      'v2.ts',
      `export const people = table('people', { id: serial().primaryKey(), displayName: varchar(200), bio: text() })`,
    )
    const latestUp = async () => {
      const ids = (await readdir(migrationsDir)).filter((e) => e !== '_journal.json').toSorted()
      return readFile(path.join(migrationsDir, ids.at(-1)!, 'up.sql'), 'utf8')
    }
    return { v2, now, latestUp }
  }

  it('asks about tables, then about columns inside the renamed table', async () => {
    const { v2, now, latestUp } = await setup()
    const asked: unknown[] = []
    await generate({
      name: 'rename',
      config: v2,
      cwd: dir,
      now,
      askRenames: async (c) => {
        asked.push(c)
        return c.tables.length > 0
          ? { tables: { users: 'people' } }
          : { columns: { 'people.fullName': 'displayName' } }
      },
    })
    expect(asked).toEqual([
      { tables: [{ from: 'users', to: ['people'] }], columns: [] },
      {
        tables: [],
        columns: [
          { table: 'people', from: 'fullName', to: ['displayName', 'bio'] },
          { table: 'people', from: 'nickname', to: ['displayName', 'bio'] },
        ],
      },
    ])
    const up = await latestUp()
    expect(up).toContain('ALTER TABLE "users" RENAME TO "people";')
    expect(up).toContain('RENAME COLUMN "fullName" TO "displayName";')
    expect(up).toContain('DROP COLUMN "nickname";')
    expect(up).not.toContain('DROP TABLE')
  })

  it("doesn't offer a name a flag already claimed, but still asks about the drop", async () => {
    const migrationsDir = path.join(dir, 'migrations')
    const now = () => new Date(Date.UTC(2026, 9, 3, 12, 0, 0))
    const write = async (file: string, body: string) => {
      await writeFile(
        path.join(dir, file),
        `import { serial, table, text } from '@forinda/kickjs-db'\n${body}`,
      )
      return { schemaPath: path.join(dir, file), migrationsDir, dialect: 'postgres' as const }
    }
    await generate({
      name: 'init',
      config: await write(
        'a.ts',
        `export const users = table('users', { id: serial().primaryKey(), a: text(), b: text() })
export const orders = table('orders', { id: serial().primaryKey() })`,
      ),
      cwd: dir,
      now,
    })
    const asked: unknown[] = []
    await generate({
      name: 'next',
      config: await write(
        'b.ts',
        `export const people = table('people', { id: serial().primaryKey(), x: text(), y: text() })
export const members = table('members', { id: serial().primaryKey() })`,
      ),
      cwd: dir,
      now: () => new Date(Date.UTC(2026, 9, 3, 12, 1, 0)),
      renames: { tables: { orders: 'members' }, columns: {} },
      askRenames: async (c) => {
        asked.push(c)
        return c.tables.length > 0
          ? { tables: { users: 'people' } }
          : { columns: { 'people.b': 'y' } }
      },
    })
    // users could have become people or members; a flag claimed members.
    expect(asked[0]).toEqual({ tables: [{ from: 'users', to: ['people'] }], columns: [] })
  })

  it('a column name a flag claimed is not offered', async () => {
    const { v2, now } = await setup()
    const asked: { columns: { to: string[] }[] }[] = []
    await generate({
      name: 'rename',
      config: v2,
      cwd: dir,
      now,
      renames: { tables: { users: 'people' }, columns: { 'people.fullName': 'displayName' } },
      askRenames: async (c) => {
        asked.push(c)
        return {}
      },
    })
    expect(asked).toEqual([
      { tables: [], columns: [{ table: 'people', from: 'nickname', to: ['bio'] }] },
    ])
  })

  it('without a prompt, warns about each drop that could have been a rename', async () => {
    const { v2, now } = await setup()
    const warned: string[] = []
    await generate({
      name: 'rename',
      config: v2,
      cwd: dir,
      now,
      renames: { tables: { users: 'people' } },
      onPossibleRename: (d) => warned.push(d.flag),
    })
    expect(warned).toEqual([
      '--rename-column people.fullName=<displayName|bio>',
      '--rename-column people.nickname=<displayName|bio>',
    ])
  })
})

describe('rename flags and the terminal prompt', () => {
  it('parses the flags', () => {
    expect(parseRenameFlags(['users=people'], ['billing.invoices.total=amount'])).toEqual({
      tables: { users: 'people' },
      columns: { 'billing.invoices.total': 'amount' },
    })
    expect(() => parseRenameFlags(['users'])).toThrow(/expects old=new/)
    expect(() => parseRenameFlags([], ['total=amount'])).toThrow(/table.old=new/)
  })

  it('asks per drop; a number renames, and a taken name is not offered again', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let shown = ''
    output.on('data', (d) => (shown += d))
    // fullName takes displayName, so for nickname option 1 is bio.
    const answers = ['1', '1', '1']
    output.on('data', () => {
      if (shown.endsWith('> ')) input.write(`${answers.shift()}\n`)
    })
    const hints = await askRenamesInTerminal(
      {
        tables: [{ from: 'users', to: ['people'] }],
        columns: [
          { table: 'people', from: 'fullName', to: ['displayName', 'bio'] },
          { table: 'people', from: 'nickname', to: ['displayName', 'bio'] },
        ],
      },
      { input, output },
    )
    expect(hints).toEqual({
      tables: { users: 'people' },
      columns: { 'people.fullName': 'displayName', 'people.nickname': 'bio' },
    })
    expect(shown).toContain('Column people.nickname is gone. Was it renamed?')
  })

  it('Enter drops it', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    output.on('data', (d) => {
      if (String(d).endsWith('> ')) input.write('\n')
    })
    const hints = await askRenamesInTerminal(
      { tables: [{ from: 'users', to: ['people'] }], columns: [] },
      { input, output },
    )
    expect(hints).toEqual({ tables: {}, columns: {} })
  })
})
