import { describe, it, expect } from 'vitest'
import { renderSchemaSource } from '@forinda/kickjs-db'
import type { FkAction, ForeignKeySnapshot, SchemaSnapshot } from '@forinda/kickjs-db'

describe('renderSchemaSource()', () => {
  it('renders a simple two-table schema with FK + indexes', () => {
    const snap: SchemaSnapshot = {
      version: 1,
      dialect: 'postgres',
      tables: {
        users: {
          name: 'users',
          columns: {
            id: {
              name: 'id',
              type: 'serial',
              nullable: false,
              default: null,
              primaryKey: true,
            },
            email: {
              name: 'email',
              type: 'varchar(255)',
              nullable: false,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [
            { name: 'users_email_unique', columns: ['email'], unique: true },
            { name: 'users_email_idx', columns: ['email'], unique: false },
          ],
          foreignKeys: [],
          checks: [],
        },
        posts: {
          name: 'posts',
          columns: {
            id: {
              name: 'id',
              type: 'serial',
              nullable: false,
              default: null,
              primaryKey: true,
            },
            authorId: {
              name: 'authorId',
              type: 'integer',
              nullable: false,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [],
          foreignKeys: [
            {
              name: 'posts_authorId_fk',
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
    }

    const src = renderSchemaSource(snap)

    // Imports include every helper the rendered tables touch.
    expect(src).toMatch(/import \{[^}]*table[^}]*\} from '@forinda\/kickjs-db'/)
    expect(src).toContain('serial')
    expect(src).toContain('varchar')
    expect(src).toContain('integer')
    expect(src).toContain('index')

    // Auto-named unique becomes inline .unique() on the column.
    expect(src).toContain('email: varchar(255).notNull().unique()')

    // Custom-named index becomes the constraint callback.
    expect(src).toMatch(/users_email_idx[\s\S]*index\('users_email_idx'\)\.on\(t\.email\)/)

    // FK on posts.authorId becomes inline .references().
    expect(src).toContain(
      `authorId: integer().notNull().references(() => users.id, { onDelete: 'cascade' })`,
    )

    // Both tables are exported as named consts.
    expect(src).toContain('export const users = table(')
    expect(src).toContain('export const posts = table(')
  })

  it('escapes table names that start with digits', () => {
    const snap: SchemaSnapshot = {
      version: 1,
      dialect: 'postgres',
      tables: {
        '99_logs': {
          name: '99_logs',
          columns: {
            id: {
              name: 'id',
              type: 'serial',
              nullable: false,
              default: null,
              primaryKey: true,
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    }
    const src = renderSchemaSource(snap)
    expect(src).toContain(`export const _99_logs = table('99_logs', {`)
  })

  it('emits a TODO comment for unrecognized column types', () => {
    const snap: SchemaSnapshot = {
      version: 1,
      dialect: 'postgres',
      tables: {
        weird: {
          name: 'weird',
          columns: {
            x: {
              name: 'x',
              type: 'tsvector',
              nullable: false,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    }
    const src = renderSchemaSource(snap)
    expect(src).toContain('TODO: tsvector')
  })
})

describe('renderSchemaSource() — foreign keys (#643)', () => {
  const twoTables = (fkName: string, onDelete: FkAction = 'no_action'): SchemaSnapshot => ({
    version: 1,
    dialect: 'postgres',
    tables: {
      users: {
        name: 'users',
        columns: {
          id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        },
        indexes: [],
        foreignKeys: [],
        checks: [],
      },
      orders: {
        name: 'orders',
        columns: {
          id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
          customer_id: {
            name: 'customer_id',
            type: 'integer',
            nullable: false,
            default: null,
            primaryKey: false,
          },
        },
        indexes: [],
        foreignKeys: [
          {
            name: fkName,
            columns: ['customer_id'],
            refTable: 'users',
            refColumns: ['id'],
            onDelete,
            onUpdate: 'no_action',
          },
        ],
        checks: [],
      },
    },
  })

  it('renders a Postgres-named foreign key instead of dropping it to a TODO', () => {
    // Postgres names constraints `<table>_<col>_fkey`. The renderer used to
    // inline an FK only when the name matched the DSL-derived `_fk` form, so
    // every key from a real database became a comment.
    const src = renderSchemaSource(twoTables('orders_customer_id_fkey'))

    expect(src).toContain('.references(() => users.id')
    expect(src).not.toContain('TODO')
  })

  it('preserves a non-derived constraint name so the next diff is empty', () => {
    const src = renderSchemaSource(twoTables('fk_orders_customer'))
    expect(src).toContain("name: 'fk_orders_customer'")
  })

  it('omits the name when it is the one the DSL would derive', () => {
    const src = renderSchemaSource(twoTables('orders_customer_id_fk'))
    expect(src).toContain('.references(() => users.id)')
    expect(src).not.toContain('name:')
  })

  it('keeps onDelete alongside a preserved name', () => {
    const src = renderSchemaSource(twoTables('orders_customer_id_fkey', 'cascade'))
    expect(src).toContain(
      ".references(() => users.id, { onDelete: 'cascade', name: 'orders_customer_id_fkey' })",
    )
  })

  it('still reports a composite foreign key as a TODO', () => {
    const snap = twoTables('orders_customer_id_fkey')
    snap.tables.orders.foreignKeys = [
      {
        name: 'orders_composite_fkey',
        columns: ['customer_id', 'id'],
        refTable: 'users',
        refColumns: ['id', 'id'],
        onDelete: 'no_action',
        onUpdate: 'no_action',
      },
    ]
    const src = renderSchemaSource(snap)
    expect(src).toContain('TODO: kick db introspect — composite foreign keys')
    expect(src).toContain('orders_composite_fkey')
  })
})

describe('renderSchemaSource() — foreign keys the DSL cannot inline', () => {
  const withFks = (fks: ForeignKeySnapshot[]): SchemaSnapshot => ({
    version: 1,
    dialect: 'postgres',
    tables: {
      users: {
        name: 'users',
        columns: {
          id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        },
        indexes: [],
        foreignKeys: [],
        checks: [],
      },
      orders: {
        name: 'orders',
        columns: {
          customer_id: {
            name: 'customer_id',
            type: 'integer',
            nullable: false,
            default: null,
            primaryKey: false,
          },
        },
        indexes: [],
        foreignKeys: fks,
        checks: [],
      },
    },
  })

  const fk = (name: string): ForeignKeySnapshot => ({
    name,
    columns: ['customer_id'],
    refTable: 'users',
    refColumns: ['id'],
    onDelete: 'no_action',
    onUpdate: 'no_action',
  })

  it('reports both when one column carries two foreign keys', () => {
    // `.references()` says "this column points at X" once. Inlining the first
    // would make the file look complete while the second survived only as a
    // comment, so neither is inlined.
    const src = renderSchemaSource(
      withFks([fk('orders_customer_a_fkey'), fk('orders_customer_b_fkey')]),
    )

    expect(src).not.toContain('.references(')
    expect(src).toContain('orders_customer_a_fkey')
    expect(src).toContain('orders_customer_b_fkey')
  })

  it('still inlines when the column carries exactly one', () => {
    const src = renderSchemaSource(withFks([fk('orders_customer_id_fkey')]))
    expect(src).toContain('.references(() => users.id')
    expect(src).not.toContain('TODO')
  })
})

describe('renderSchemaSource() — names that are not safe in a literal', () => {
  const named = (opts: { table?: string; fk?: string; index?: string }): SchemaSnapshot => ({
    version: 1,
    dialect: 'postgres',
    tables: {
      users: {
        name: 'users',
        columns: {
          id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        },
        indexes: [],
        foreignKeys: [],
        checks: [],
      },
      [opts.table ?? 'orders']: {
        name: opts.table ?? 'orders',
        columns: {
          customer_id: {
            name: 'customer_id',
            type: 'integer',
            nullable: false,
            default: null,
            primaryKey: false,
          },
        },
        indexes: opts.index ? [{ name: opts.index, columns: ['customer_id'], unique: false }] : [],
        foreignKeys: opts.fk
          ? [
              {
                name: opts.fk,
                columns: ['customer_id'],
                refTable: 'users',
                refColumns: ['id'],
                onDelete: 'no_action',
                onUpdate: 'no_action',
              },
            ]
          : [],
        checks: [],
      },
    },
  })

  // A quoted Postgres identifier may legally contain a quote or a backslash.
  it('escapes a quote in a constraint name', () => {
    const src = renderSchemaSource(named({ fk: "customer'fk" }))
    expect(src).toContain('name: "customer\'fk"')
  })

  it('escapes a quote in a table name', () => {
    expect(renderSchemaSource(named({ table: "odd'table" }))).toContain('table("odd\'table"')
  })

  it('escapes a quote in an index name', () => {
    expect(renderSchemaSource(named({ index: "odd'idx" }))).toContain('index("odd\'idx")')
  })

  it('escapes a backslash', () => {
    expect(renderSchemaSource(named({ fk: 'back\\slash' }))).toContain('name: "back\\\\slash"')
  })

  it('leaves an ordinary name in single quotes', () => {
    expect(renderSchemaSource(named({ fk: 'plain_fkey' }))).toContain("name: 'plain_fkey'")
  })
})
