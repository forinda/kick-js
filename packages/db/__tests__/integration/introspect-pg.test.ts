import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { introspectPg } from '@forinda/kickjs-db'

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

beforeEach(async () => {
  // Drop everything between tests so each test starts from a clean schema.
  await client.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `)
})

describe('introspectPg()', () => {
  it('extracts the canonical SchemaSnapshot for a 2-table schema with FK + indexes', async () => {
    await client.query(`
      CREATE TABLE "users" (
        "id" serial NOT NULL,
        "email" varchar(255) NOT NULL,
        "name" varchar(120),
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "is_active" boolean NOT NULL DEFAULT true,
        PRIMARY KEY ("id")
      );
      CREATE TABLE "posts" (
        "id" serial NOT NULL,
        "author_id" integer NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" text NOT NULL,
        PRIMARY KEY ("id")
      );
      CREATE INDEX "users_email_idx" ON "users" ("email");
      CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
      CREATE UNIQUE INDEX "posts_title_author_unique" ON "posts" ("title", "author_id");
      ALTER TABLE "posts" ADD CONSTRAINT "posts_author_fk"
        FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `)

    const snap = await introspectPg(client)

    expect(snap.version).toBe(1)
    expect(snap.dialect).toBe('postgres')
    expect(Object.keys(snap.tables).toSorted()).toEqual(['posts', 'users'])

    expect(snap.tables.users.columns.id).toEqual({
      name: 'id',
      type: 'serial',
      nullable: false,
      default: null,
      primaryKey: true,
    })
    expect(snap.tables.users.columns.email).toEqual({
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    })
    expect(snap.tables.users.columns.created_at).toMatchObject({
      type: 'timestamptz',
      default: 'CURRENT_TIMESTAMP',
    })
    expect(snap.tables.users.columns.is_active).toMatchObject({
      type: 'boolean',
      default: 'true',
    })

    // Indexes — the PK-backing index is excluded; user-defined ones are kept.
    expect(snap.tables.users.indexes.map((i) => i.name).toSorted()).toEqual([
      'users_email_idx',
      'users_email_unique',
    ])
    const unique = snap.tables.users.indexes.find((i) => i.name === 'users_email_unique')
    expect(unique?.unique).toBe(true)
    expect(unique?.columns).toEqual(['email'])

    // Multi-column unique on posts
    const multiUnique = snap.tables.posts.indexes.find(
      (i) => i.name === 'posts_title_author_unique',
    )
    expect(multiUnique?.unique).toBe(true)
    expect(multiUnique?.columns).toEqual(['title', 'author_id'])

    // FK
    expect(snap.tables.posts.foreignKeys).toEqual([
      {
        name: 'posts_author_fk',
        columns: ['author_id'],
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no_action',
      },
    ])
  }, 60_000)

  it('skips kick_migrations + kick_migrations_lock tables', async () => {
    await client.query(`
      CREATE TABLE "kick_migrations" ("id" varchar(128) PRIMARY KEY);
      CREATE TABLE "kick_migrations_lock" ("id" smallint PRIMARY KEY);
      CREATE TABLE "users" ("id" serial PRIMARY KEY);
    `)
    const snap = await introspectPg(client)
    expect(snap.tables.kick_migrations).toBeUndefined()
    expect(snap.tables.kick_migrations_lock).toBeUndefined()
    expect(snap.tables.users).toBeDefined()
  }, 60_000)
})
