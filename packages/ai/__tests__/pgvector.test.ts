/**
 * Unit tests for `PgVectorStore`.
 *
 * The store accepts any duck-typed `SqlExecutor` — these tests pass
 * in a fake executor that records every `query` call and returns
 * scripted rows. That lets us verify the SQL we generate, the
 * parameter binding, and the first-use schema migration without
 * running a real Postgres instance.
 *
 * Backend-specific behavior (the `<=>` operator, pgvector wire
 * format, JSONB filtering semantics) is covered by the SQL assertions
 * here plus manual integration testing against a real database. A
 * full end-to-end Postgres test would require testcontainers or a
 * local cluster — overkill for the unit-test layer.
 *
 * @module @forinda/kickjs-ai/__tests__/pgvector.test
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  PgVectorStore,
  buildWhereClause,
  toPgVector,
  type SqlExecutor,
} from '@forinda/kickjs-ai'

// ── Fake SQL executor ────────────────────────────────────────────────────

interface CapturedCall {
  text: string
  params: unknown[]
}

/**
 * Records every query call and returns scripted rows in FIFO order.
 * Missing scripts default to `{ rows: [] }` so calls that don't need
 * a specific return value (INSERT / DELETE / TRUNCATE) don't need to
 * be set up individually.
 */
class FakeExecutor implements SqlExecutor {
  public readonly calls: CapturedCall[] = []
  private readonly scripts: Array<{ rows: unknown[] }> = []

  script(rows: unknown[]): this {
    this.scripts.push({ rows })
    return this
  }

  async query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ text, params: params ?? [] })
    const scripted = this.scripts.shift()
    return { rows: (scripted?.rows ?? []) as T[] }
  }

  /** Return all captured calls that match a SQL substring. */
  callsMatching(fragment: string): CapturedCall[] {
    return this.calls.filter((c) => c.text.includes(fragment))
  }

  /** The most recent non-setup call, i.e. the one the test is actually asserting on. */
  lastBusinessCall(): CapturedCall {
    // Filter out the schema setup calls so tests can focus on the
    // upsert/query/delete SQL they care about.
    const business = this.calls.filter(
      (c) =>
        !c.text.includes('CREATE EXTENSION') &&
        !c.text.includes('CREATE TABLE IF NOT EXISTS'),
    )
    return business[business.length - 1]
  }
}

// ── Construction ──────────────────────────────────────────────────────────

describe('PgVectorStore — construction', () => {
  it('throws when neither client nor connectionString is provided', () => {
    expect(
      () => new PgVectorStore({ dimensions: 3 } as never),
    ).toThrow(/client.*connectionString/)
  })

  it('throws on invalid dimensions', () => {
    const client = new FakeExecutor()
    expect(
      () => new PgVectorStore({ client, dimensions: 0 }),
    ).toThrow(/dimensions.*positive/)
    expect(
      () => new PgVectorStore({ client, dimensions: -5 }),
    ).toThrow(/dimensions.*positive/)
    expect(
      () => new PgVectorStore({ client, dimensions: 1.5 }),
    ).toThrow(/dimensions.*positive/)
  })

  it('exposes default name and allows override', () => {
    const client = new FakeExecutor()
    expect(new PgVectorStore({ client, dimensions: 3 }).name).toBe('pgvector')
    expect(
      new PgVectorStore({ client, dimensions: 3, name: 'timescale' }).name,
    ).toBe('timescale')
  })
})

// ── Schema setup ──────────────────────────────────────────────────────────

describe('PgVectorStore — schema setup', () => {
  let client: FakeExecutor
  let store: PgVectorStore

  beforeEach(() => {
    client = new FakeExecutor()
    store = new PgVectorStore({ client, dimensions: 3 })
  })

  it('runs CREATE EXTENSION + CREATE TABLE on first use', async () => {
    await store.count()
    expect(client.callsMatching('CREATE EXTENSION IF NOT EXISTS vector')).toHaveLength(1)
    expect(client.callsMatching('CREATE TABLE IF NOT EXISTS')).toHaveLength(1)
  })

  it('includes the configured dimensions in the table definition', async () => {
    const s = new PgVectorStore({ client, dimensions: 768 })
    await s.count()
    const createTable = client.callsMatching('CREATE TABLE IF NOT EXISTS')[0]
    expect(createTable.text).toContain('vector(768)')
  })

  it('uses the default schema + table names', async () => {
    await store.count()
    const createTable = client.callsMatching('CREATE TABLE IF NOT EXISTS')[0]
    expect(createTable.text).toContain('"public"."kickjs_embeddings"')
  })

  it('honors custom schema and table names with quoting', async () => {
    const s = new PgVectorStore({
      client,
      dimensions: 3,
      schema: 'ai',
      table: 'docs',
    })
    await s.count()
    const createTable = client.callsMatching('CREATE TABLE IF NOT EXISTS')[0]
    expect(createTable.text).toContain('"ai"."docs"')
  })

  it('runs the setup migration only once across multiple calls', async () => {
    await store.count()
    await store.count()
    await store.count()
    expect(client.callsMatching('CREATE EXTENSION')).toHaveLength(1)
    expect(client.callsMatching('CREATE TABLE IF NOT EXISTS')).toHaveLength(1)
  })

  it('skips setup when skipSetup is true', async () => {
    const s = new PgVectorStore({ client, dimensions: 3, skipSetup: true })
    await s.count()
    expect(client.callsMatching('CREATE EXTENSION')).toHaveLength(0)
    expect(client.callsMatching('CREATE TABLE IF NOT EXISTS')).toHaveLength(0)
  })
})

// ── upsert ────────────────────────────────────────────────────────────────

describe('PgVectorStore — upsert', () => {
  let client: FakeExecutor
  let store: PgVectorStore

  beforeEach(() => {
    client = new FakeExecutor()
    store = new PgVectorStore({ client, dimensions: 3, skipSetup: true })
  })

  it('emits an INSERT ... ON CONFLICT (id) DO UPDATE for a single document', async () => {
    await store.upsert({ id: '1', content: 'hello', vector: [1, 0, 0] })

    const call = client.lastBusinessCall()
    expect(call.text).toContain('INSERT INTO')
    expect(call.text).toContain('ON CONFLICT (id) DO UPDATE')
    expect(call.text).toContain('($1, $2, $3::vector, $4::jsonb)')
    expect(call.params).toEqual(['1', 'hello', '[1,0,0]', '{}'])
  })

  it('batches multiple documents into a single INSERT', async () => {
    await store.upsert([
      { id: '1', content: 'a', vector: [1, 0, 0] },
      { id: '2', content: 'b', vector: [0, 1, 0] },
      { id: '3', content: 'c', vector: [0, 0, 1] },
    ])

    const call = client.lastBusinessCall()
    expect(call.text).toContain('($1, $2, $3::vector, $4::jsonb)')
    expect(call.text).toContain('($5, $6, $7::vector, $8::jsonb)')
    expect(call.text).toContain('($9, $10, $11::vector, $12::jsonb)')
    expect(call.params).toHaveLength(12)
  })

  it('serializes metadata to JSON string in the parameter list', async () => {
    await store.upsert({
      id: '1',
      content: 'x',
      vector: [1, 2, 3],
      metadata: { author: 'alice', year: 2024 },
    })

    const call = client.lastBusinessCall()
    expect(call.params[3]).toBe('{"author":"alice","year":2024}')
  })

  it('defaults metadata to an empty object', async () => {
    await store.upsert({ id: '1', content: 'x', vector: [1, 2, 3] })
    const call = client.lastBusinessCall()
    expect(call.params[3]).toBe('{}')
  })

  it('rejects documents with missing id', async () => {
    await expect(
      store.upsert({ id: '', content: 'x', vector: [1, 0, 0] }),
    ).rejects.toThrow(/id is required/)
  })

  it('rejects documents with a non-array vector', async () => {
    await expect(
      store.upsert({
        id: '1',
        content: 'x',
        vector: 'not-a-vector' as unknown as number[],
      }),
    ).rejects.toThrow(/vector must be an array/)
  })

  it('rejects documents whose vector length does not match dimensions', async () => {
    await expect(
      store.upsert({ id: '1', content: 'x', vector: [1, 2] }),
    ).rejects.toThrow(/length 2.*dimensions 3/)
  })

  it('is a no-op when given an empty array', async () => {
    await store.upsert([])
    expect(client.lastBusinessCall()).toBeUndefined()
  })
})

// ── query ─────────────────────────────────────────────────────────────────

describe('PgVectorStore — query', () => {
  let client: FakeExecutor
  let store: PgVectorStore

  beforeEach(() => {
    client = new FakeExecutor()
    store = new PgVectorStore({ client, dimensions: 3, skipSetup: true })
  })

  it('generates the expected SQL for a no-filter query', async () => {
    client.script([
      { id: 'a', content: 'first', metadata: {}, score: 0.95 },
      { id: 'b', content: 'second', metadata: {}, score: 0.82 },
    ])

    const hits = await store.query({ vector: [1, 0, 0], topK: 10 })

    const call = client.lastBusinessCall()
    expect(call.text).toContain('SELECT id, content, metadata,')
    expect(call.text).toContain('(1 - (vector <=> $1::vector)) AS score')
    expect(call.text).toContain('FROM "public"."kickjs_embeddings"')
    expect(call.text).toContain('ORDER BY vector <=> $1::vector')
    expect(call.text).toContain('LIMIT $2')
    expect(call.params).toEqual(['[1,0,0]', 10])
    expect(hits).toHaveLength(2)
    expect(hits[0].id).toBe('a')
    expect(hits[0].score).toBe(0.95)
  })

  it('defaults topK to 5', async () => {
    client.script([])
    await store.query({ vector: [1, 0, 0] })
    const call = client.lastBusinessCall()
    expect(call.params[call.params.length - 1]).toBe(5)
  })

  it('adds a WHERE clause with metadata filter (scalar)', async () => {
    client.script([])
    await store.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: { category: 'fruit' },
    })

    const call = client.lastBusinessCall()
    expect(call.text).toContain("WHERE metadata->>'category' = $2")
    // Param order: [vector, filterValue, topK]
    expect(call.params).toEqual(['[1,0,0]', 'fruit', 10])
  })

  it('adds an ANY clause for array filter values', async () => {
    client.script([])
    await store.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: { category: ['fruit', 'veg'] },
    })

    const call = client.lastBusinessCall()
    expect(call.text).toContain("metadata->>'category' = ANY($2::text[])")
    expect(call.params).toEqual(['[1,0,0]', ['fruit', 'veg'], 10])
  })

  it('combines multiple filter keys with AND', async () => {
    client.script([])
    await store.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: { category: 'fruit', year: 2024 },
    })

    const call = client.lastBusinessCall()
    expect(call.text).toContain("metadata->>'category' = $2")
    expect(call.text).toContain("AND metadata->>'year' = $3")
    expect(call.params).toEqual(['[1,0,0]', 'fruit', '2024', 10])
  })

  it('drops hits below minScore', async () => {
    client.script([
      { id: 'a', content: 'high', metadata: {}, score: 0.9 },
      { id: 'b', content: 'low', metadata: {}, score: 0.3 },
    ])

    const hits = await store.query({ vector: [1, 0, 0], topK: 10, minScore: 0.5 })
    expect(hits.map((h) => h.id)).toEqual(['a'])
  })

  it('throws on empty vector', async () => {
    await expect(store.query({ vector: [] })).rejects.toThrow(/vector is required/)
  })

  it('throws on dimension mismatch', async () => {
    await expect(store.query({ vector: [1, 2] })).rejects.toThrow(
      /length 2.*dimensions 3/,
    )
  })

  it('surfaces metadata on returned hits', async () => {
    client.script([
      { id: 'a', content: 'x', metadata: { author: 'alice' }, score: 0.9 },
    ])

    const hits = await store.query({ vector: [1, 0, 0] })
    expect(hits[0].metadata).toEqual({ author: 'alice' })
  })
})

// ── delete / count ───────────────────────────────────────────────────────

describe('PgVectorStore — delete and count', () => {
  let client: FakeExecutor
  let store: PgVectorStore

  beforeEach(() => {
    client = new FakeExecutor()
    store = new PgVectorStore({ client, dimensions: 3, skipSetup: true })
  })

  it('deletes a single id via ANY clause', async () => {
    await store.delete('abc')
    const call = client.lastBusinessCall()
    expect(call.text).toContain('DELETE FROM')
    expect(call.text).toContain('WHERE id = ANY($1::text[])')
    expect(call.params).toEqual([['abc']])
  })

  it('deletes an array of ids in one call', async () => {
    await store.delete(['a', 'b', 'c'])
    const call = client.lastBusinessCall()
    expect(call.params).toEqual([['a', 'b', 'c']])
  })

  it('is a no-op for an empty id array', async () => {
    await store.delete([])
    expect(client.lastBusinessCall()).toBeUndefined()
  })

  it('deleteAll uses TRUNCATE', async () => {
    await store.deleteAll()
    const call = client.lastBusinessCall()
    expect(call.text).toContain('TRUNCATE')
    expect(call.text).toContain('"public"."kickjs_embeddings"')
  })

  it('count parses the string result into a number', async () => {
    client.script([{ count: '42' }])
    const n = await store.count()
    expect(n).toBe(42)
  })

  it('count returns 0 for an empty table', async () => {
    client.script([{ count: '0' }])
    expect(await store.count()).toBe(0)
  })
})

// ── close ────────────────────────────────────────────────────────────────

describe('PgVectorStore — close', () => {
  it('does not call end() on a user-supplied client', async () => {
    const endSpy = { end: () => Promise.resolve() }
    // User-supplied client — no connectionString
    const store = new PgVectorStore({
      client: { ...endSpy, query: async () => ({ rows: [] }) } as never,
      dimensions: 3,
      skipSetup: true,
    })
    let ended = false
    ;(store as unknown as { client: { end: () => Promise<void> } }).client.end = async () => {
      ended = true
    }
    await store.close()
    expect(ended).toBe(false)
  })
})

// ── Helpers: toPgVector + buildWhereClause ───────────────────────────────

describe('toPgVector', () => {
  it('formats a simple integer vector', () => {
    expect(toPgVector([1, 2, 3])).toBe('[1,2,3]')
  })

  it('preserves floating-point values', () => {
    expect(toPgVector([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]')
  })

  it('replaces NaN / Infinity / -Infinity with 0', () => {
    expect(toPgVector([1, NaN, 3])).toBe('[1,0,3]')
    expect(toPgVector([Infinity, -Infinity, 0])).toBe('[0,0,0]')
  })

  it('handles the empty vector', () => {
    expect(toPgVector([])).toBe('[]')
  })
})

describe('buildWhereClause', () => {
  it('returns empty sql + params when filter is undefined', () => {
    const result = buildWhereClause(undefined, 2)
    expect(result.whereSql).toBe('')
    expect(result.whereParams).toEqual([])
  })

  it('returns empty sql + params when filter is empty', () => {
    const result = buildWhereClause({}, 2)
    expect(result.whereSql).toBe('')
    expect(result.whereParams).toEqual([])
  })

  it('starts parameter numbering at the given index', () => {
    const result = buildWhereClause({ a: 'x', b: 'y' }, 5)
    expect(result.whereSql).toContain('$5')
    expect(result.whereSql).toContain('$6')
  })

  it('coerces non-string scalar values to strings', () => {
    const result = buildWhereClause({ year: 2024, active: true }, 1)
    expect(result.whereParams).toEqual(['2024', 'true'])
  })

  it('coerces null and undefined to empty strings', () => {
    const result = buildWhereClause({ a: null, b: undefined }, 1)
    expect(result.whereParams).toEqual(['', ''])
  })

  it('rejects keys with unsupported characters', () => {
    expect(() => buildWhereClause({ "name'; DROP": 'x' }, 1)).toThrow(
      /unsupported characters/,
    )
    expect(() => buildWhereClause({ '$injection': 'x' }, 1)).toThrow(
      /unsupported characters/,
    )
  })

  it('allows keys with dots, dashes, and underscores', () => {
    const result = buildWhereClause(
      {
        'nested.path': 'x',
        'kebab-key': 'y',
        'snake_key': 'z',
      },
      1,
    )
    expect(result.whereSql).toContain("metadata->>'nested.path'")
    expect(result.whereSql).toContain("metadata->>'kebab-key'")
    expect(result.whereSql).toContain("metadata->>'snake_key'")
  })

  it('array values become ANY(text[])', () => {
    const result = buildWhereClause({ tag: ['a', 'b'] }, 1)
    expect(result.whereSql).toBe("WHERE metadata->>'tag' = ANY($1::text[])")
    expect(result.whereParams).toEqual([['a', 'b']])
  })

  it('array values coerce each element to string', () => {
    const result = buildWhereClause({ year: [2023, 2024] }, 1)
    expect(result.whereParams).toEqual([['2023', '2024']])
  })
})
