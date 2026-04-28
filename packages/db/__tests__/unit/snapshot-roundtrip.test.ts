import { describe, it, expect } from 'vitest'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

describe('SchemaSnapshot JSON roundtrip', () => {
  it('preserves a 2-table snapshot through stringify/parse', () => {
    const original: SchemaSnapshot = {
      version: 1,
      dialect: 'postgres',
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
            email: {
              name: 'email',
              type: 'varchar(255)',
              nullable: false,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [{ name: 'users_email_unique', columns: ['email'], unique: true }],
          foreignKeys: [],
          checks: [],
        },
        posts: {
          name: 'posts',
          columns: {
            id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
            authorId: {
              name: 'author_id',
              type: 'integer',
              nullable: false,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [],
          foreignKeys: [
            {
              name: 'posts_author_fk',
              columns: ['author_id'],
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

    const roundtripped: SchemaSnapshot = JSON.parse(JSON.stringify(original))

    expect(roundtripped).toEqual(original)
  })
})
