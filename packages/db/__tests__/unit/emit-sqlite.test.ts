import { describe, it, expect } from 'vitest'
import { emitSqlite, SqliteRebuildRequiredError } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

const col = (over: Partial<import('@forinda/kickjs-db').ColumnSnapshot> = {}) => ({
  name: 'c',
  type: 'text',
  nullable: true,
  default: null,
  primaryKey: false,
  ...over,
})

describe('emitSqlite — CREATE TABLE', () => {
  it('maps PG types to SQLite affinities + normalises defaults', () => {
    const cs: ChangeSet = [
      {
        kind: 'createTable',
        table: {
          name: 'tasks',
          columns: {
            id: col({
              name: 'id',
              type: 'uuid',
              nullable: false,
              primaryKey: true,
              default: 'gen_random_uuid()',
            }),
            title: col({ name: 'title', type: 'varchar(200)', nullable: false }),
            done: col({ name: 'done', type: 'boolean', nullable: false, default: 'false' }),
            createdAt: col({
              name: 'createdAt',
              type: 'timestamp',
              nullable: false,
              default: 'CURRENT_TIMESTAMP',
            }),
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    ]
    expect(emitSqlite(cs)).toBe(
      'CREATE TABLE "tasks" (\n' +
        '  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),\n' +
        '  "title" TEXT NOT NULL,\n' +
        '  "done" INTEGER NOT NULL DEFAULT 0,\n' +
        '  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n' +
        '  PRIMARY KEY ("id")\n' +
        ');',
    )
  })

  it('inlines a single integer PK as INTEGER PRIMARY KEY (rowid alias)', () => {
    const cs: ChangeSet = [
      {
        kind: 'createTable',
        table: {
          name: 'nums',
          columns: { id: col({ name: 'id', type: 'serial', nullable: false, primaryKey: true }) },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    ]
    // Inline, with AUTOINCREMENT for serial; no separate PRIMARY KEY clause.
    expect(emitSqlite(cs)).toBe(
      'CREATE TABLE "nums" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT\n);',
    )
  })

  it('inlines foreign keys into CREATE TABLE and skips their addForeignKey change', () => {
    const cs: ChangeSet = [
      {
        kind: 'createTable',
        table: {
          name: 'posts',
          columns: {
            id: col({ name: 'id', type: 'integer', nullable: false, primaryKey: true }),
            authorId: col({ name: 'authorId', type: 'integer', nullable: false }),
          },
          indexes: [],
          foreignKeys: [
            {
              name: 'posts_author_fk',
              columns: ['authorId'],
              refTable: 'users',
              refColumns: ['id'],
              onDelete: 'cascade',
              onUpdate: 'no_action',
            },
          ],
          checks: [],
        },
      },
      // The diff emits this separately for a new table — must be a no-op.
      {
        kind: 'addForeignKey',
        table: 'posts',
        fk: {
          name: 'posts_author_fk',
          columns: ['authorId'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        },
      },
    ]
    const sql = emitSqlite(cs)
    expect(sql).toContain('"id" INTEGER PRIMARY KEY')
    expect(sql).toContain(
      'FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    )
    // exactly one statement (the FK change folded in, not a separate ALTER)
    expect(sql.match(/;/g)?.length).toBe(1)
  })
})

describe('emitSqlite — ALTER', () => {
  it('add / drop / rename column + indexes', () => {
    expect(
      emitSqlite([
        {
          kind: 'addColumn',
          table: 'tasks',
          column: col({ name: 'priority', type: 'integer', nullable: false, default: '0' }),
        },
      ]),
    ).toBe('ALTER TABLE "tasks" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;')

    expect(
      emitSqlite([{ kind: 'dropColumn', table: 'tasks', column: col({ name: 'priority' }) }]),
    ).toBe('ALTER TABLE "tasks" DROP COLUMN "priority";')

    expect(emitSqlite([{ kind: 'renameColumn', table: 'tasks', from: 'a', to: 'b' }])).toBe(
      'ALTER TABLE "tasks" RENAME COLUMN "a" TO "b";',
    )

    expect(
      emitSqlite([
        {
          kind: 'addIndex',
          table: 'tasks',
          index: { name: 'tasks_done_idx', columns: ['done'], unique: false },
        },
      ]),
    ).toBe('CREATE INDEX "tasks_done_idx" ON "tasks" ("done");')

    expect(
      emitSqlite([
        {
          kind: 'dropIndex',
          table: 'tasks',
          index: { name: 'tasks_done_idx', columns: ['done'], unique: false },
        },
      ]),
    ).toBe('DROP INDEX "tasks_done_idx";')
  })

  it('throws SqliteRebuildRequiredError for column alteration', () => {
    expect(() =>
      emitSqlite([
        {
          kind: 'alterColumn',
          table: 'tasks',
          column: 'title',
          before: col({ name: 'title', type: 'varchar(50)' }),
          after: col({ name: 'title', type: 'text' }),
        },
      ]),
    ).toThrow(SqliteRebuildRequiredError)
  })

  it('throws SqliteRebuildRequiredError for FK on an existing table', () => {
    expect(() =>
      emitSqlite([
        {
          kind: 'addForeignKey',
          table: 'posts',
          fk: {
            name: 'fk',
            columns: ['x'],
            refTable: 'u',
            refColumns: ['id'],
            onDelete: 'no_action',
            onUpdate: 'no_action',
          },
        },
      ]),
    ).toThrow(SqliteRebuildRequiredError)
  })
})

import type { SchemaSnapshot } from '@forinda/kickjs-db'

const tbl = (
  name: string,
  cols: Record<string, Partial<import('@forinda/kickjs-db').ColumnSnapshot>>,
  indexes: import('@forinda/kickjs-db').IndexSnapshot[] = [],
) => ({
  name,
  columns: Object.fromEntries(Object.entries(cols).map(([n, o]) => [n, col({ name: n, ...o })])),
  indexes,
  foreignKeys: [],
  checks: [],
})

describe('emitSqlite — table rebuild (alterColumn with snapshots)', () => {
  it('rebuilds the table: create _kick_new / copy common cols / drop / rename / reindex', () => {
    const from: SchemaSnapshot = {
      version: 1,
      dialect: 'sqlite',
      tables: {
        tasks: tbl(
          'tasks',
          {
            id: { type: 'integer', nullable: false, primaryKey: true },
            title: { type: 'varchar(50)', nullable: true },
          },
          [{ name: 'tasks_title_idx', columns: ['title'], unique: false }],
        ),
      },
    }
    const to: SchemaSnapshot = {
      version: 1,
      dialect: 'sqlite',
      tables: {
        tasks: tbl(
          'tasks',
          {
            id: { type: 'integer', nullable: false, primaryKey: true },
            title: { type: 'text', nullable: false }, // type + nullability changed
          },
          [{ name: 'tasks_title_idx', columns: ['title'], unique: false }],
        ),
      },
    }
    const sql = emitSqlite(
      [
        {
          kind: 'alterColumn',
          table: 'tasks',
          column: 'title',
          before: from.tables.tasks.columns.title,
          after: to.tables.tasks.columns.title,
        },
      ],
      { from, to },
    )
    expect(sql).toBe(
      'CREATE TABLE "_kick_new_tasks" (\n' +
        '  "id" INTEGER PRIMARY KEY,\n' +
        '  "title" TEXT NOT NULL\n' +
        ');\n' +
        'INSERT INTO "_kick_new_tasks" ("id", "title")\n' +
        '  SELECT "id", "title" FROM "tasks";\n' +
        'DROP TABLE "tasks";\n' +
        'ALTER TABLE "_kick_new_tasks" RENAME TO "tasks";\n' +
        'CREATE INDEX "tasks_title_idx" ON "tasks" ("title");',
    )
  })

  it('copies only the column intersection (a dropped column is not selected)', () => {
    const from: SchemaSnapshot = {
      version: 1,
      dialect: 'sqlite',
      tables: {
        t: tbl('t', {
          id: { type: 'integer', primaryKey: true, nullable: false },
          gone: { type: 'text' },
          keep: { type: 'text' },
        }),
      },
    }
    const to: SchemaSnapshot = {
      version: 1,
      dialect: 'sqlite',
      tables: {
        t: tbl('t', {
          id: { type: 'integer', primaryKey: true, nullable: false },
          keep: { type: 'integer' },
        }),
      },
    }
    const sql = emitSqlite(
      [
        {
          kind: 'alterColumn',
          table: 't',
          column: 'keep',
          before: from.tables.t.columns.keep,
          after: to.tables.t.columns.keep,
        },
      ],
      { from, to },
    )
    expect(sql).toContain(
      'INSERT INTO "_kick_new_t" ("id", "keep")\n  SELECT "id", "keep" FROM "t";',
    )
    expect(sql).not.toContain('gone')
  })

  it('still throws when no snapshot is supplied (bare call)', () => {
    expect(() =>
      emitSqlite([
        {
          kind: 'alterColumn',
          table: 'tasks',
          column: 'title',
          before: col({ name: 'title', type: 'varchar(50)' }),
          after: col({ name: 'title', type: 'text' }),
        },
      ]),
    ).toThrow(SqliteRebuildRequiredError)
  })
})
