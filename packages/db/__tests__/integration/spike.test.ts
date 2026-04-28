import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import {
  table,
  relations,
  serial,
  integer,
  varchar,
  index,
  unique,
  extractSnapshot,
  diff,
  emitPg,
} from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

const users = table(
  'users',
  {
    id: serial().primaryKey(),
    email: varchar(255).notNull().unique(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
  }),
)

const posts = table(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
  },
  (t) => ({
    uniqTitle: unique('posts_title_author_unique').on(t.title, t.authorId),
  }),
)

const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))

let container: StartedPostgreSqlContainer
let client: pg.Client

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  client = new pg.Client({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  await client.connect()
}, 90_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

describe('spike — full pipeline (PG)', () => {
  it('extract → diff → emit → apply → introspect produces target schema', async () => {
    const target = extractSnapshot({ users, posts, usersRelations }, 'postgres')
    const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

    const sql = emitPg(diff(empty, target))
    await client.query(sql)

    // Verify users + posts exist
    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `)
    expect(tables.rows.map((r) => r.table_name)).toEqual(['posts', 'users'])

    // Verify users.email is varchar(255) NOT NULL
    const cols = await client.query<{
      column_name: string
      data_type: string
      is_nullable: string
      character_maximum_length: number | null
    }>(`
      SELECT column_name, data_type, is_nullable, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position
    `)
    const email = cols.rows.find((r) => r.column_name === 'email')
    expect(email).toBeDefined()
    expect(email!.data_type).toBe('character varying')
    expect(email!.character_maximum_length).toBe(255)
    expect(email!.is_nullable).toBe('NO')

    // Verify FK posts.authorId -> users.id with CASCADE
    const fks = await client.query<{ constraint_name: string; on_delete: string }>(`
      SELECT tc.constraint_name, rc.delete_rule AS on_delete
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc USING (constraint_name)
      WHERE tc.table_name = 'posts' AND tc.constraint_type = 'FOREIGN KEY'
    `)
    expect(fks.rows).toHaveLength(1)
    expect(fks.rows[0].constraint_name).toBe('posts_authorId_fk')
    expect(fks.rows[0].on_delete).toBe('CASCADE')

    // Verify index users_email_idx exists
    const idxs = await client.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_idx'
    `)
    expect(idxs.rows).toHaveLength(1)
  }, 60_000)
})
