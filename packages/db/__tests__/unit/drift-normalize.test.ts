import { describe, it, expect } from 'vitest'
import { checkDrift } from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

const col = (over: Partial<import('@forinda/kickjs-db').ColumnSnapshot>) => ({
  name: 'c',
  type: 'text',
  nullable: true,
  default: null,
  primaryKey: false,
  ...over,
})

// Stored snapshot — code-first DSL types + defaults.
const stored: SchemaSnapshot = {
  version: 1,
  dialect: 'sqlite',
  tables: {
    tasks: {
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
      },
      indexes: [{ name: 'tasks_done_idx', columns: ['done'], unique: false }],
      foreignKeys: [],
      checks: [],
    },
  },
}

// Live snapshot — what introspectSqlite reads back from the same DB.
const live: SchemaSnapshot = {
  version: 1,
  dialect: 'sqlite',
  tables: {
    tasks: {
      name: 'tasks',
      columns: {
        id: col({
          name: 'id',
          type: 'text',
          nullable: false,
          primaryKey: true,
          default: 'lower(hex(randomblob(16)))',
        }),
        title: col({ name: 'title', type: 'text', nullable: false }),
        done: col({ name: 'done', type: 'integer', nullable: false, default: '0' }),
      },
      indexes: [{ name: 'tasks_done_idx', columns: ['done'], unique: false }],
      foreignKeys: [],
      checks: [],
    },
  },
}

describe('checkDrift — dialect normalization (sqlite)', () => {
  it('does NOT flag drift between a DSL snapshot and its lossy introspection', async () => {
    // uuid↔text, varchar(200)↔text, boolean↔integer, gen_random_uuid()↔
    // randomblob, false↔0 all collapse under normalization → no drift.
    await expect(checkDrift(live, stored, 'error')).resolves.toBeUndefined()
  })

  it('still flags a real structural drift (live gained a column)', async () => {
    const drifted: SchemaSnapshot = {
      ...live,
      tables: {
        tasks: {
          ...live.tables.tasks,
          columns: { ...live.tables.tasks.columns, sneaky: col({ name: 'sneaky', type: 'text' }) },
        },
      },
    }
    await expect(checkDrift(drifted, stored, 'error')).rejects.toThrow(/drift/i)
  })

  it('flags a type change that survives normalization (text → integer)', async () => {
    const typeChanged: SchemaSnapshot = {
      ...live,
      tables: {
        tasks: {
          ...live.tables.tasks,
          columns: {
            ...live.tables.tasks.columns,
            title: col({ name: 'title', type: 'integer', nullable: false }),
          },
        },
      },
    }
    // stored title is varchar→text; live now integer → real drift.
    await expect(checkDrift(typeChanged, stored, 'error')).rejects.toThrow(/drift/i)
  })
})
