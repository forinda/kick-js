/**
 * Real-PG round trip for `detectCompositeReferences` (M4.C).
 *
 * Boots a Postgres 16 Testcontainer, plants:
 *   - an enum (`user_status`),
 *   - a composite type whose attribute holds the enum, and
 *   - a second composite whose attribute holds an array of the enum,
 * and asserts the helper finds both rows. Also verifies the
 * negative path (no composite references the enum) and the qualified-
 * name path (the helper restricts to the named schema).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { detectCompositeReferences } from '@forinda/kickjs-db'

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
  // Drop everything between tests so the catalog state stays scoped.
  await client.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT typname, n.nspname FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE t.typtype IN ('c', 'e') AND n.nspname IN ('public', 'analytics')
                  AND t.typname NOT LIKE 'pg_%' AND NOT EXISTS (
                    SELECT 1 FROM pg_class c WHERE c.reltype = t.oid AND c.relkind != 'c'
                  )) LOOP
        EXECUTE 'DROP TYPE IF EXISTS "' || r.nspname || '"."' || r.typname || '" CASCADE';
      END LOOP;
    END $$;
    DROP SCHEMA IF EXISTS analytics CASCADE;
  `)
})

describe('detectCompositeReferences (real PG)', () => {
  it('returns [] when the enum has no composite references', async () => {
    await client.query(`CREATE TYPE user_status AS ENUM ('active', 'banned')`)

    const refs = await detectCompositeReferences(client, 'user_status')

    expect(refs).toEqual([])
  })

  it('finds composite types whose attributes hold the enum directly', async () => {
    await client.query(`
      CREATE TYPE user_status AS ENUM ('active', 'banned');
      CREATE TYPE address_t AS (
        line1 text,
        status user_status
      );
    `)

    const refs = await detectCompositeReferences(client, 'user_status')

    expect(refs).toEqual([
      {
        composite: 'public.address_t',
        attribute: 'status',
        enum: 'public.user_status',
      },
    ])
  })

  it('finds composite attributes that hold an array of the enum', async () => {
    await client.query(`
      CREATE TYPE user_status AS ENUM ('active', 'banned');
      CREATE TYPE membership_t AS (
        kind text,
        history user_status[]
      );
    `)

    const refs = await detectCompositeReferences(client, 'user_status')

    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      composite: 'public.membership_t',
      attribute: 'history',
      enum: 'public.user_status',
    })
  })

  it('respects schema qualification when the caller passes one', async () => {
    await client.query(`
      CREATE SCHEMA analytics;
      CREATE TYPE analytics.event_kind AS ENUM ('click', 'view');
      CREATE TYPE public.event_kind AS ENUM ('click', 'view');
      CREATE TYPE public.row_t AS (
        kind public.event_kind
      );
    `)

    // Looking for the public-schema enum should only find the public composite.
    const publicRefs = await detectCompositeReferences(client, 'public.event_kind')
    expect(publicRefs).toEqual([
      {
        composite: 'public.row_t',
        attribute: 'kind',
        enum: 'public.event_kind',
      },
    ])

    // Looking for the analytics-schema enum should find nothing.
    const analyticsRefs = await detectCompositeReferences(client, 'analytics.event_kind')
    expect(analyticsRefs).toEqual([])
  })
})
