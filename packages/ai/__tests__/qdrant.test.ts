/**
 * Tests for `QdrantVectorStore`.
 *
 * The suite mocks `globalThis.fetch` — we never hit a real Qdrant
 * instance. Coverage:
 *
 *   1. Construction — validation, url normalization, auth header
 *   2. Lazy collection setup — first call triggers PUT /collections,
 *      second call does NOT re-trigger it
 *   3. upsert — payload shape, dimension validation
 *   4. query — body shape, filter translation, result normalization
 *   5. delete / deleteAll / count — wire shapes
 *   6. Filter builder — equality + IN translation (pure unit)
 *
 * @module @forinda/kickjs-ai/__tests__/qdrant.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QdrantVectorStore, buildQdrantFilter } from '../src'

let fetchSpy: ReturnType<typeof vi.spyOn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function emptyOk(): Response {
  return new Response('', { status: 200 })
}

/**
 * Response bodies can only be read once — so reusing a single
 * `Response` across multiple fetch calls throws "Body is unusable" on
 * the second read. For tests that fire multiple HTTP calls, install
 * a factory via `mockImplementation` so every call gets a fresh
 * Response instance built from the given body factory.
 */
function mockAlwaysJson(body: unknown, status = 200): void {
  fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse(body, status)))
}

function mockAlwaysEmpty(): void {
  fetchSpy.mockImplementation(() => Promise.resolve(emptyOk()))
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

// ── Construction ──────────────────────────────────────────────────────────

describe('QdrantVectorStore — construction', () => {
  it('requires a collection name', () => {
    expect(
      () => new QdrantVectorStore({ collection: '', dimensions: 4 }),
    ).toThrow(/collection is required/)
  })

  it('requires positive integer dimensions', () => {
    expect(
      () => new QdrantVectorStore({ collection: 'docs', dimensions: 0 }),
    ).toThrow(/dimensions/)
    expect(
      () => new QdrantVectorStore({ collection: 'docs', dimensions: -1 }),
    ).toThrow(/dimensions/)
    expect(
      () => new QdrantVectorStore({ collection: 'docs', dimensions: 1.5 }),
    ).toThrow(/dimensions/)
  })

  it('exposes name as "qdrant" by default', () => {
    const store = new QdrantVectorStore({ collection: 'docs', dimensions: 4 })
    expect(store.name).toBe('qdrant')
  })

  it('accepts a name override', () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 4,
      name: 'qdrant-prod',
    })
    expect(store.name).toBe('qdrant-prod')
  })

  it('strips trailing slash from url', async () => {
    const store = new QdrantVectorStore({
      url: 'https://qdrant.example.com/',
      collection: 'docs',
      dimensions: 4,
    })
    mockAlwaysJson({ result: { count: 0 } })
    await store.count()
    const urls = fetchSpy.mock.calls.map((c) => c[0])
    // First call = collection setup, second = count
    expect(urls[0]).toBe('https://qdrant.example.com/collections/docs')
    expect(urls[1]).toBe('https://qdrant.example.com/collections/docs/points/count')
  })

  it('omits api-key header when not configured', async () => {
    const store = new QdrantVectorStore({ collection: 'docs', dimensions: 4 })
    mockAlwaysEmpty()
    await store.deleteAll()
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['api-key']).toBeUndefined()
  })

  it('sends api-key header when configured', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 4,
      apiKey: 'qd-secret',
    })
    mockAlwaysEmpty()
    await store.deleteAll()
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['api-key']).toBe('qd-secret')
  })
})

// ── Lazy collection setup ─────────────────────────────────────────────────

describe('QdrantVectorStore — lazy setup', () => {
  it('PUTs the collection with size + distance on first write', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
    })
    mockAlwaysJson({ result: true })

    await store.upsert({ id: '1', content: 'hi', vector: [0.1, 0.2, 0.3] })

    // First call = PUT /collections/docs
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect(url).toBe('http://localhost:6333/collections/docs')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      vectors: { size: 3, distance: 'Cosine' },
    })
  })

  it('caches setup — subsequent writes do not re-PUT the collection', async () => {
    const store = new QdrantVectorStore({ collection: 'docs', dimensions: 3 })
    mockAlwaysJson({ result: true })

    await store.upsert({ id: '1', content: 'a', vector: [0.1, 0.2, 0.3] })
    fetchSpy.mockClear()

    await store.upsert({ id: '2', content: 'b', vector: [0.4, 0.5, 0.6] })
    // Only the points upsert should fire — no second collection PUT.
    const methods = fetchSpy.mock.calls.map((c) => (c[1] as RequestInit).method)
    const urls = fetchSpy.mock.calls.map((c) => c[0])
    expect(methods).toEqual(['PUT'])
    expect(urls[0]).toContain('/points')
  })

  it('honors distance override on setup', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 2,
      distance: 'Dot',
    })
    mockAlwaysJson({ result: true })
    await store.upsert({ id: '1', content: 'x', vector: [0.1, 0.2] })
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.vectors.distance).toBe('Dot')
  })

  it('skips setup when skipSetup is true', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    mockAlwaysJson({ result: true })
    await store.upsert({ id: '1', content: 'a', vector: [0.1, 0.2, 0.3] })

    // Only the points upsert should fire.
    expect(fetchSpy.mock.calls).toHaveLength(1)
    expect(fetchSpy.mock.calls[0][0]).toContain('/points')
  })

  it('retries setup after a failure', async () => {
    const store = new QdrantVectorStore({ collection: 'docs', dimensions: 3 })
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    await expect(
      store.upsert({ id: '1', content: 'a', vector: [0.1, 0.2, 0.3] }),
    ).rejects.toThrow(/500/)

    // Next call should re-trigger setup (cache cleared on failure).
    mockAlwaysJson({ result: true })
    await store.upsert({ id: '1', content: 'a', vector: [0.1, 0.2, 0.3] })
    const methods = fetchSpy.mock.calls.map((c) => (c[1] as RequestInit).method)
    // Expected calls: [PUT /collections (failed), PUT /collections (retry), PUT /points]
    expect(methods).toEqual(['PUT', 'PUT', 'PUT'])
  })
})

// ── upsert ────────────────────────────────────────────────────────────────

describe('QdrantVectorStore.upsert()', () => {
  it('rejects vectors whose length does not match dimensions', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    await expect(
      store.upsert({ id: '1', content: 'a', vector: [0.1, 0.2] }),
    ).rejects.toThrow(/dimensions/)
  })

  it('rejects documents without an id', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    await expect(
      store.upsert({ id: '', content: 'a', vector: [0.1, 0.2, 0.3] }),
    ).rejects.toThrow(/id is required/)
  })

  it('sends the expected points payload with nested payload.metadata', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    mockAlwaysJson({ result: { operation_id: 1 } })

    await store.upsert([
      {
        id: 'a',
        content: 'alpha',
        vector: [0.1, 0.2, 0.3],
        metadata: { author: 'Ada' },
      },
      { id: 'b', content: 'beta', vector: [0.4, 0.5, 0.6] },
    ])

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:6333/collections/docs/points?wait=true')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      points: [
        {
          id: 'a',
          vector: [0.1, 0.2, 0.3],
          payload: { content: 'alpha', metadata: { author: 'Ada' } },
        },
        {
          id: 'b',
          vector: [0.4, 0.5, 0.6],
          payload: { content: 'beta', metadata: {} },
        },
      ],
    })
  })
})

// ── query ─────────────────────────────────────────────────────────────────

describe('QdrantVectorStore.query()', () => {
  it('posts a search body with vector, limit, with_payload', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        result: [
          {
            id: 'a',
            score: 0.92,
            payload: { content: 'alpha', metadata: { author: 'Ada' } },
          },
          {
            id: 'b',
            score: 0.71,
            payload: { content: 'beta', metadata: { author: 'Bob' } },
          },
        ],
      }),
    )

    const hits = await store.query({ vector: [0.1, 0.2, 0.3], topK: 2 })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.vector).toEqual([0.1, 0.2, 0.3])
    expect(body.limit).toBe(2)
    expect(body.with_payload).toBe(true)

    expect(hits).toEqual([
      { id: 'a', content: 'alpha', score: 0.92, metadata: { author: 'Ada' } },
      { id: 'b', content: 'beta', score: 0.71, metadata: { author: 'Bob' } },
    ])
  })

  it('includes filter when provided', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    fetchSpy.mockResolvedValueOnce(jsonResponse({ result: [] }))

    await store.query({
      vector: [0.1, 0.2, 0.3],
      filter: { author: 'Ada', tag: ['blog', 'draft'] },
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.filter).toEqual({
      must: [
        { key: 'metadata.author', match: { value: 'Ada' } },
        { key: 'metadata.tag', match: { any: ['blog', 'draft'] } },
      ],
    })
  })

  it('passes score_threshold when minScore is set', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    fetchSpy.mockResolvedValueOnce(jsonResponse({ result: [] }))

    await store.query({ vector: [0.1, 0.2, 0.3], minScore: 0.75 })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.score_threshold).toBe(0.75)
  })

  it('rejects mismatched query vector length', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    await expect(store.query({ vector: [0.1, 0.2] })).rejects.toThrow(/dimensions/)
  })
})

// ── delete / deleteAll / count ───────────────────────────────────────────

describe('QdrantVectorStore — lifecycle operations', () => {
  it('delete posts the point ids to /points/delete', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    fetchSpy.mockResolvedValueOnce(jsonResponse({ result: { operation_id: 2 } }))

    await store.delete(['a', 'b'])

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:6333/collections/docs/points/delete?wait=true')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ points: ['a', 'b'] })
  })

  it('deleteAll drops and recreates the collection', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
    })
    mockAlwaysJson({ result: true })

    await store.deleteAll()

    const methods = fetchSpy.mock.calls.map((c) => (c[1] as RequestInit).method)
    const urls = fetchSpy.mock.calls.map((c) => c[0])
    expect(methods).toEqual(['DELETE', 'PUT'])
    expect(urls[0]).toBe('http://localhost:6333/collections/docs')
    expect(urls[1]).toBe('http://localhost:6333/collections/docs')
  })

  it('count posts exact: true and returns the result.count field', async () => {
    const store = new QdrantVectorStore({
      collection: 'docs',
      dimensions: 3,
      skipSetup: true,
    })
    fetchSpy.mockResolvedValueOnce(jsonResponse({ result: { count: 42 } }))

    expect(await store.count()).toBe(42)
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body).toEqual({ exact: true })
  })
})

// ── Filter builder (pure) ────────────────────────────────────────────────

describe('buildQdrantFilter', () => {
  it('translates scalar values to match.value', () => {
    expect(buildQdrantFilter({ author: 'Ada' })).toEqual({
      must: [{ key: 'metadata.author', match: { value: 'Ada' } }],
    })
  })

  it('translates array values to match.any', () => {
    expect(buildQdrantFilter({ tag: ['a', 'b'] })).toEqual({
      must: [{ key: 'metadata.tag', match: { any: ['a', 'b'] } }],
    })
  })

  it('combines multiple conditions in a single must array', () => {
    const out = buildQdrantFilter({ a: 1, b: [2, 3] })
    expect(out.must).toHaveLength(2)
  })
})
