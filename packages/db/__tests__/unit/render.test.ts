import { describe, it, expect } from 'vitest'
import { renderSchemaSource } from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

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
