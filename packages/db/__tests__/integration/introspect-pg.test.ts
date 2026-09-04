import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { introspectPg, renderSchemaSource } from '@forinda/kickjs-db'

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
      -- Types outlive their tables, so a leftover enum would leak into the
      -- next test's snapshot.
      FOR r IN (
        SELECT t.typname FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
      ) LOOP
        EXECUTE 'DROP TYPE IF EXISTS "' || r.typname || '" CASCADE';
      END LOOP;
      -- Same for standalone sequences left behind by a dropped default.
      FOR r IN (SELECT sequencename FROM pg_sequences WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP SEQUENCE IF EXISTS "' || r.sequencename || '" CASCADE';
      END LOOP;
    END $$;
  `)
})

describe('enum types against a real database (#644)', () => {
  it('reads enum types and their value order into the snapshot', async () => {
    await client.query(`
      CREATE TYPE "enum_grading_systems_type" AS ENUM ('departmental', 'general');
      CREATE TYPE "enum_strands_term_order" AS ENUM ('1', '2', '3');
      CREATE TABLE "grading_systems" (
        "id" serial PRIMARY KEY,
        "type" "enum_grading_systems_type" NOT NULL DEFAULT 'departmental'
      );
    `)

    const snap = await introspectPg(client)

    expect(snap.enums).toEqual({
      enum_grading_systems_type: {
        name: 'enum_grading_systems_type',
        // Declaration order, not alphabetical — for an enum it is part of the
        // type: comparisons and ORDER BY follow it.
        values: ['departmental', 'general'],
      },
      enum_strands_term_order: {
        name: 'enum_strands_term_order',
        values: ['1', '2', '3'],
      },
    })

    // The column already carried the type name; it now has a declaration.
    expect(snap.tables.grading_systems.columns.type).toMatchObject({
      type: 'enum_grading_systems_type',
      default: 'departmental',
    })
  })

  it('omits the enums key entirely when the database declares none', async () => {
    await client.query(`CREATE TABLE "plain" ("id" serial PRIMARY KEY);`)
    expect((await introspectPg(client)).enums).toBeUndefined()
  })

  it('rebuilds the enum type from the rendered schema', async () => {
    // The end of the reported bug: introspect a database with an enum, render
    // it, and the generated schema must declare the type rather than reference
    // one that does not exist.
    await client.query(`
      CREATE TYPE "mood" AS ENUM ('sad', 'ok', 'happy');
      CREATE TABLE "people" (
        "id" serial PRIMARY KEY,
        "mood" "mood" NOT NULL DEFAULT 'ok'
      );
    `)

    const src = renderSchemaSource(await introspectPg(client))

    expect(src).toContain("export const mood = pgEnum('mood', 'sad', 'ok', 'happy')")
    expect(src).toContain('mood: mood().notNull().default("ok")')
    expect(src).not.toContain('TODO')
  })
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
