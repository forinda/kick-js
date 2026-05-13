/**
 * Architecture-spec §13 hardening — migration replay against real PG.
 *
 * For every fixture (`from`, `to`) pair, exercises the full
 * diff → emit → execute → introspect cycle three times:
 *
 *   1. **Forward:** apply `diff(from, to)`, introspect, assert the
 *      DB state matches `to`. Catches missing changes in the diff,
 *      bad SQL emit, or introspection round-trip drift.
 *   2. **Reverse:** apply `invertChanges(diff(from, to))`, introspect,
 *      assert the DB state matches `from`. Catches the inverter
 *      omitting a change or producing un-applyable SQL.
 *   3. **Replay:** re-apply the original forward, introspect, assert
 *      it matches `to` again. Catches non-idempotent reverse — i.e.,
 *      a reverse that doesn't fully restore the pre-state, leaving
 *      the second apply in a different shape.
 *
 * One container, one client per file (~5s boot). `beforeEach` resets
 * the schema so fixtures don't pollute one another.
 *
 * Companion to the in-memory diff-engine fuzz in
 * `packages/db/__tests__/fuzz/diff-roundtrip.test.ts` — that asserts
 * the structural property; this one asserts the SQL pipeline works
 * end-to-end against a real database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { diff, emitPg, introspectPg, invertChanges } from '@forinda/kickjs-db'
import type { SchemaSnapshot, TableSnapshot } from '@forinda/kickjs-db'
import { FIXTURES } from './migration-replay-fixtures'

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
  // Drop every user-defined table between fixtures so each replay
  // starts from a known-empty state. Cascade so FKs don't block.
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

/**
 * Execute the SQL `emitPg` produces for the given change set.
 * Splits on `;` so each statement runs separately and a failure
 * surfaces with its own line context. Empty trailing chunk skipped.
 */
async function applyChanges(changes: Parameters<typeof emitPg>[0]): Promise<void> {
  if (changes.length === 0) return
  const sql = emitPg(changes)
  // Statements emitted by emit/pg.ts are individually `;`-terminated.
  // Split + filter so blank tail and inter-statement whitespace
  // don't surface as empty queries.
  const statements = sql
    .split(/;\s*\n?/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  for (const stmt of statements) {
    await client.query(stmt + ';')
  }
}

/**
 * Snapshot equality tolerant of cosmetic introspection differences.
 * Compares tables / columns / indexes / FKs by name + canonical
 * payload, sidestepping object-key order. `version` and `dialect`
 * checked strictly.
 */
function snapshotsEquivalent(
  a: SchemaSnapshot,
  b: SchemaSnapshot,
): { ok: boolean; reason: string } {
  if (a.version !== b.version) return { ok: false, reason: `version: ${a.version} vs ${b.version}` }
  if (a.dialect !== b.dialect) return { ok: false, reason: `dialect: ${a.dialect} vs ${b.dialect}` }

  const aTables = Object.keys(a.tables).toSorted()
  const bTables = Object.keys(b.tables).toSorted()
  if (aTables.join(',') !== bTables.join(',')) {
    return { ok: false, reason: `tables mismatch: [${aTables}] vs [${bTables}]` }
  }
  for (const t of aTables) {
    const r = tablesEquivalent(a.tables[t] as TableSnapshot, b.tables[t] as TableSnapshot)
    if (!r.ok) return { ok: false, reason: `table "${t}": ${r.reason}` }
  }
  return { ok: true, reason: '' }
}

function tablesEquivalent(a: TableSnapshot, b: TableSnapshot): { ok: boolean; reason: string } {
  if (a.name !== b.name) return { ok: false, reason: `name: ${a.name} vs ${b.name}` }
  const aCols = Object.keys(a.columns).toSorted()
  const bCols = Object.keys(b.columns).toSorted()
  if (aCols.join(',') !== bCols.join(',')) {
    return { ok: false, reason: `columns set: [${aCols}] vs [${bCols}]` }
  }
  for (const c of aCols) {
    const av = a.columns[c]
    const bv = b.columns[c]
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      return { ok: false, reason: `column "${c}": ${JSON.stringify(av)} vs ${JSON.stringify(bv)}` }
    }
  }
  const aIdx = new Map(a.indexes.map((i) => [i.name, JSON.stringify(i)]))
  const bIdx = new Map(b.indexes.map((i) => [i.name, JSON.stringify(i)]))
  if (aIdx.size !== bIdx.size) {
    return { ok: false, reason: `indexes count: ${aIdx.size} vs ${bIdx.size}` }
  }
  for (const [name, payload] of aIdx) {
    if (bIdx.get(name) !== payload) {
      return { ok: false, reason: `index "${name}": ${payload} vs ${bIdx.get(name)}` }
    }
  }
  const aFk = new Map(a.foreignKeys.map((f) => [f.name, JSON.stringify(f)]))
  const bFk = new Map(b.foreignKeys.map((f) => [f.name, JSON.stringify(f)]))
  if (aFk.size !== bFk.size) {
    return { ok: false, reason: `FK count: ${aFk.size} vs ${bFk.size}` }
  }
  for (const [name, payload] of aFk) {
    if (bFk.get(name) !== payload) {
      return { ok: false, reason: `FK "${name}": ${payload} vs ${bFk.get(name)}` }
    }
  }
  return { ok: true, reason: '' }
}

describe('migration replay against real PG — apply / reverse / re-apply cycle', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.label}: forward apply matches \`to\``, async () => {
      if (Object.keys(fixture.from.tables).length > 0) {
        await applyChanges(diff(emptySnapshot(), fixture.from))
      }
      const forward = diff(fixture.from, fixture.to)
      await applyChanges(forward)

      const introspected = await introspectPg(client)
      const r = snapshotsEquivalent(introspected, fixture.to)
      expect(r.ok, `mismatch — ${r.reason}`).toBe(true)
    }, 60_000)

    it(`${fixture.label}: reverse undoes back to \`from\``, async () => {
      if (Object.keys(fixture.from.tables).length > 0) {
        await applyChanges(diff(emptySnapshot(), fixture.from))
      }
      const forward = diff(fixture.from, fixture.to)
      await applyChanges(forward)
      const reverse = invertChanges(forward)
      await applyChanges(reverse)

      const introspected = await introspectPg(client)
      const r = snapshotsEquivalent(introspected, fixture.from)
      expect(r.ok, `mismatch — ${r.reason}`).toBe(true)
    }, 60_000)

    it(`${fixture.label}: re-apply after reverse matches \`to\``, async () => {
      if (Object.keys(fixture.from.tables).length > 0) {
        await applyChanges(diff(emptySnapshot(), fixture.from))
      }
      const forward = diff(fixture.from, fixture.to)
      await applyChanges(forward)
      const reverse = invertChanges(forward)
      await applyChanges(reverse)
      await applyChanges(forward)

      const introspected = await introspectPg(client)
      const r = snapshotsEquivalent(introspected, fixture.to)
      expect(r.ok, `mismatch — ${r.reason}`).toBe(true)
    }, 60_000)
  }
})

function emptySnapshot(): SchemaSnapshot {
  return { version: 1, dialect: 'postgres', tables: {} }
}
