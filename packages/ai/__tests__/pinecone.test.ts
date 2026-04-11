/**
 * Tests for `PineconeVectorStore`.
 *
 * All tests mock `globalThis.fetch`. Coverage:
 *
 *   1. Construction — validation, indexHost scheme handling, auth
 *   2. upsert — vector shape, metadata flattening
 *   3. query — body shape, filter translation, content/metadata split
 *   4. delete / deleteAll / count — wire shapes, namespace handling
 *   5. Filter builder — scalar/array/operator-passthrough (pure unit)
 *
 * @module @forinda/kickjs-ai/__tests__/pinecone.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PineconeVectorStore, buildPineconeFilter } from '../src'

let fetchSpy: ReturnType<typeof vi.spyOn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

// ── Construction ──────────────────────────────────────────────────────────

describe('PineconeVectorStore — construction', () => {
  it('requires an apiKey', () => {
    expect(
      () =>
        new PineconeVectorStore({
          apiKey: '',
          indexHost: 'x.pinecone.io',
          dimensions: 4,
        }),
    ).toThrow(/apiKey is required/)
  })

  it('requires an indexHost', () => {
    expect(
      () =>
        new PineconeVectorStore({
          apiKey: 'pc-test',
          indexHost: '',
          dimensions: 4,
        }),
    ).toThrow(/indexHost is required/)
  })

  it('requires positive integer dimensions', () => {
    expect(
      () =>
        new PineconeVectorStore({
          apiKey: 'pc-test',
          indexHost: 'x.pinecone.io',
          dimensions: 0,
        }),
    ).toThrow(/dimensions/)
  })

  it('adds https:// scheme when missing', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'my-index.svc.us-east-1-aws.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValue(jsonResponse({}))
    await store.delete('x')
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://my-index.svc.us-east-1-aws.pinecone.io/vectors/delete',
    )
  })

  it('keeps explicit https:// scheme if provided', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'https://my-index.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValue(jsonResponse({}))
    await store.delete('x')
    expect(fetchSpy.mock.calls[0][0]).toBe('https://my-index.pinecone.io/vectors/delete')
  })

  it('sends Api-Key and X-Pinecone-API-Version headers', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-secret',
      indexHost: 'my-index.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValue(jsonResponse({}))
    await store.delete('x')
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['Api-Key']).toBe('pc-secret')
    expect(headers['X-Pinecone-API-Version']).toBeDefined()
  })

  it('defaults name to "pinecone"', () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    expect(store.name).toBe('pinecone')
  })
})

// ── upsert ────────────────────────────────────────────────────────────────

describe('PineconeVectorStore.upsert()', () => {
  it('rejects vectors whose length does not match dimensions', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    await expect(
      store.upsert({ id: '1', content: 'a', vector: [0.1, 0.2] }),
    ).rejects.toThrow(/dimensions/)
  })

  it('flattens content + metadata into a single Pinecone metadata record', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValue(jsonResponse({ upsertedCount: 2 }))

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
    expect(url).toBe('https://x.pinecone.io/vectors/upsert')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.vectors).toEqual([
      {
        id: 'a',
        values: [0.1, 0.2, 0.3],
        metadata: { content: 'alpha', author: 'Ada' },
      },
      {
        id: 'b',
        values: [0.4, 0.5, 0.6],
        metadata: { content: 'beta' },
      },
    ])
  })

  it('includes namespace in the body when configured', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
      namespace: 'tenant-42',
    })
    fetchSpy.mockResolvedValue(jsonResponse({}))

    await store.upsert({ id: 'a', content: 'alpha', vector: [0.1, 0.2, 0.3] })
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.namespace).toBe('tenant-42')
  })
})

// ── query ─────────────────────────────────────────────────────────────────

describe('PineconeVectorStore.query()', () => {
  it('posts vector + topK + includeMetadata', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        matches: [
          {
            id: 'a',
            score: 0.92,
            metadata: { content: 'alpha', author: 'Ada' },
          },
        ],
      }),
    )

    const hits = await store.query({ vector: [0.1, 0.2, 0.3], topK: 5 })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x.pinecone.io/query')
    const body = JSON.parse(init.body as string)
    expect(body.vector).toEqual([0.1, 0.2, 0.3])
    expect(body.topK).toBe(5)
    expect(body.includeMetadata).toBe(true)

    expect(hits).toEqual([
      {
        id: 'a',
        content: 'alpha',
        score: 0.92,
        metadata: { author: 'Ada' },
      },
    ])
  })

  it('translates equality filter to Pinecone DSL', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValueOnce(jsonResponse({ matches: [] }))

    await store.query({
      vector: [0.1, 0.2, 0.3],
      filter: { author: 'Ada', tag: ['blog', 'draft'] },
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.filter).toEqual({
      author: { $eq: 'Ada' },
      tag: { $in: ['blog', 'draft'] },
    })
  })

  it('applies minScore client-side', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        matches: [
          { id: 'a', score: 0.9, metadata: { content: 'a' } },
          { id: 'b', score: 0.4, metadata: { content: 'b' } },
        ],
      }),
    )

    const hits = await store.query({
      vector: [0.1, 0.2, 0.3],
      minScore: 0.7,
    })
    expect(hits.map((h) => h.id)).toEqual(['a'])
  })

  it('rejects mismatched query vector length', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    await expect(store.query({ vector: [0.1, 0.2] })).rejects.toThrow(/dimensions/)
  })
})

// ── delete / deleteAll / count ───────────────────────────────────────────

describe('PineconeVectorStore — lifecycle operations', () => {
  it('delete posts ids to /vectors/delete', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
      namespace: 'ns',
    })
    fetchSpy.mockResolvedValue(jsonResponse({}))

    await store.delete(['a', 'b'])

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x.pinecone.io/vectors/delete')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ ids: ['a', 'b'], namespace: 'ns' })
  })

  it('deleteAll posts deleteAll: true to /vectors/delete', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValue(jsonResponse({}))

    await store.deleteAll()
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body).toEqual({ deleteAll: true })
  })

  it('count reads totalVectorCount from /describe_index_stats', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
    })
    fetchSpy.mockResolvedValueOnce(jsonResponse({ totalVectorCount: 100 }))

    expect(await store.count()).toBe(100)
  })

  it('count reads namespace vectorCount when namespace is configured', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'pc-test',
      indexHost: 'x.pinecone.io',
      dimensions: 3,
      namespace: 'docs',
    })
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        namespaces: {
          docs: { vectorCount: 42 },
          other: { vectorCount: 99 },
        },
        totalVectorCount: 141,
      }),
    )

    expect(await store.count()).toBe(42)
  })
})

// ── Filter builder (pure) ────────────────────────────────────────────────

describe('buildPineconeFilter', () => {
  it('translates scalar to $eq', () => {
    expect(buildPineconeFilter({ author: 'Ada' })).toEqual({
      author: { $eq: 'Ada' },
    })
  })

  it('translates arrays to $in', () => {
    expect(buildPineconeFilter({ tag: ['a', 'b'] })).toEqual({
      tag: { $in: ['a', 'b'] },
    })
  })

  it('passes through raw operator records unchanged', () => {
    const raw = { score: { $gt: 0.5, $lt: 0.9 } }
    expect(buildPineconeFilter(raw)).toEqual(raw)
  })

  it('passes through top-level $or and $and unchanged', () => {
    const raw = { $or: [{ a: 1 }, { b: 2 }] }
    expect(buildPineconeFilter(raw)).toEqual(raw)
  })
})
