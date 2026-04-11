/**
 * Tests for the RAG primitives:
 *   1. `InMemoryVectorStore` — upsert, query, filter, delete, count,
 *      tie-breaking, empty-vector handling
 *   2. `cosineSimilarity` — directional math sanity checks
 *   3. `RagService` — index batching, search, augmentChatInput merge
 *      vs separate modes, empty-result passthrough
 *
 * Every test uses a fake `AiProvider` whose `embed` returns a
 * deterministic vector per input so we can reason about scores
 * without touching a real model.
 *
 * @module @forinda/kickjs-ai/__tests__/rag.test
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryVectorStore,
  RagService,
  cosineSimilarity,
  type AiProvider,
  type ChatInput,
  type ChatOptions,
  type ChatResponse,
  type EmbedInput,
} from '@forinda/kickjs-ai'

// ── Fake provider ─────────────────────────────────────────────────────────

/**
 * Deterministic fake provider for the RAG tests.
 *
 * `embed` hashes each input to a small 3-dimensional vector so we
 * can assert on retrieval order without touching a real model. The
 * hash is stable: identical strings produce identical vectors, and
 * strings that share leading characters get close-by vectors.
 */
class FakeProvider implements AiProvider {
  readonly name = 'fake'
  public embedCalls: string[][] = []

  async chat(_input: ChatInput, _options?: ChatOptions): Promise<ChatResponse> {
    return { content: 'stub' }
  }

  // eslint-disable-next-line require-yield
  async *stream(_input: ChatInput, _options?: ChatOptions) {
    throw new Error('FakeProvider.stream not used')
  }

  async embed(input: EmbedInput): Promise<number[][]> {
    const inputs = Array.isArray(input) ? input : [input]
    this.embedCalls.push(inputs)
    return inputs.map((s) => embedString(s))
  }
}

/**
 * Hash a string into a stable 3D vector. Each component is derived
 * from a different character-sum fold so two similar strings end up
 * with vectors pointing in similar directions. Deterministic; no
 * RNG anywhere.
 */
function embedString(s: string): number[] {
  let a = 0
  let b = 0
  let c = 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    a += code
    b += code * (i + 1)
    c += code % 7
  }
  return [a, b, c]
}

// ── cosineSimilarity ─────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
  })

  it('returns 1 for parallel vectors of different magnitudes', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1)
  })

  it('returns 0 for length mismatches without throwing', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0)
  })

  it('returns 0 for zero-magnitude vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  it('returns 0 for empty arrays', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

// ── InMemoryVectorStore ──────────────────────────────────────────────────

describe('InMemoryVectorStore — upsert and count', () => {
  let store: InMemoryVectorStore

  beforeEach(() => {
    store = new InMemoryVectorStore()
  })

  it('reports its backend name as "in-memory"', () => {
    expect(store.name).toBe('in-memory')
  })

  it('upserts a single document and counts it', async () => {
    await store.upsert({
      id: '1',
      content: 'hello world',
      vector: [1, 0, 0],
    })
    expect(await store.count()).toBe(1)
  })

  it('upserts an array of documents in one call', async () => {
    await store.upsert([
      { id: '1', content: 'a', vector: [1, 0, 0] },
      { id: '2', content: 'b', vector: [0, 1, 0] },
      { id: '3', content: 'c', vector: [0, 0, 1] },
    ])
    expect(await store.count()).toBe(3)
  })

  it('treats upsert as idempotent on id', async () => {
    await store.upsert({ id: '1', content: 'first', vector: [1, 0, 0] })
    await store.upsert({ id: '1', content: 'second', vector: [0, 1, 0] })
    expect(await store.count()).toBe(1)

    const [hit] = await store.query({ vector: [0, 1, 0], topK: 1 })
    expect(hit.content).toBe('second')
  })

  it('rejects documents without an id', async () => {
    await expect(
      store.upsert({ id: '', content: 'x', vector: [1] }),
    ).rejects.toThrow(/id is required/)
  })

  it('rejects documents with a non-array vector', async () => {
    await expect(
      // deliberately bad input
      store.upsert({ id: '1', content: 'x', vector: 42 as unknown as number[] }),
    ).rejects.toThrow(/vector must be an array/)
  })

  it('defensively copies the vector so external mutation does not corrupt storage', async () => {
    const externalVector = [1, 2, 3]
    await store.upsert({ id: '1', content: 'x', vector: externalVector })
    externalVector[0] = 999

    const [hit] = await store.query({ vector: [1, 2, 3], topK: 1 })
    expect(hit.score).toBeCloseTo(1)
  })
})

describe('InMemoryVectorStore — query', () => {
  let store: InMemoryVectorStore

  beforeEach(async () => {
    store = new InMemoryVectorStore()
    await store.upsert([
      { id: 'apple', content: 'red fruit', vector: [1, 0, 0] },
      { id: 'banana', content: 'yellow fruit', vector: [0.9, 0.1, 0] },
      { id: 'grape', content: 'purple fruit', vector: [0.1, 0.9, 0] },
      { id: 'kiwi', content: 'green fruit', vector: [0, 0, 1] },
    ])
  })

  it('returns hits ordered by descending similarity', async () => {
    const hits = await store.query({ vector: [1, 0, 0], topK: 4 })
    expect(hits.map((h) => h.id)).toEqual(['apple', 'banana', 'grape', 'kiwi'])
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('respects topK', async () => {
    const hits = await store.query({ vector: [1, 0, 0], topK: 2 })
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.id)).toEqual(['apple', 'banana'])
  })

  it('defaults topK to 5', async () => {
    const hits = await store.query({ vector: [1, 0, 0] })
    expect(hits.length).toBeLessThanOrEqual(5)
  })

  it('breaks score ties deterministically by id', async () => {
    await store.deleteAll()
    await store.upsert([
      { id: 'b', content: 'x', vector: [1, 0, 0] },
      { id: 'a', content: 'x', vector: [1, 0, 0] },
    ])
    const hits = await store.query({ vector: [1, 0, 0], topK: 2 })
    expect(hits.map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('drops hits below minScore', async () => {
    const hits = await store.query({ vector: [1, 0, 0], topK: 4, minScore: 0.5 })
    expect(hits.map((h) => h.id)).toEqual(['apple', 'banana'])
  })

  it('throws on an empty query vector', async () => {
    await expect(store.query({ vector: [] })).rejects.toThrow(/vector is required/)
  })
})

describe('InMemoryVectorStore — metadata filter', () => {
  let store: InMemoryVectorStore<{ category: string; year?: number }>

  beforeEach(async () => {
    store = new InMemoryVectorStore()
    await store.upsert([
      { id: 'a', content: 'x', vector: [1, 0, 0], metadata: { category: 'fruit', year: 2023 } },
      { id: 'b', content: 'y', vector: [1, 0, 0], metadata: { category: 'fruit', year: 2024 } },
      { id: 'c', content: 'z', vector: [1, 0, 0], metadata: { category: 'vegetable', year: 2024 } },
    ])
  })

  it('filters by equality on a single field', async () => {
    const hits = await store.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: { category: 'fruit' },
    })
    expect(hits.map((h) => h.id).sort()).toEqual(['a', 'b'])
  })

  it('filters by equality on multiple fields (AND semantics)', async () => {
    const hits = await store.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: { category: 'fruit', year: 2024 },
    })
    expect(hits.map((h) => h.id)).toEqual(['b'])
  })

  it('treats array filter values as IN clauses', async () => {
    const hits = await store.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: { category: ['vegetable', 'fruit'] },
    })
    expect(hits).toHaveLength(3)
  })

  it('drops hits whose metadata is missing the filter key', async () => {
    const unfiltered = new InMemoryVectorStore<{ category?: string }>()
    await unfiltered.upsert([
      { id: 'a', content: 'x', vector: [1, 0, 0], metadata: { category: 'fruit' } },
      { id: 'b', content: 'y', vector: [1, 0, 0] }, // no metadata
    ])
    const hits = await unfiltered.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: { category: 'fruit' },
    })
    expect(hits.map((h) => h.id)).toEqual(['a'])
  })
})

describe('InMemoryVectorStore — delete', () => {
  let store: InMemoryVectorStore

  beforeEach(async () => {
    store = new InMemoryVectorStore()
    await store.upsert([
      { id: '1', content: 'a', vector: [1, 0, 0] },
      { id: '2', content: 'b', vector: [0, 1, 0] },
      { id: '3', content: 'c', vector: [0, 0, 1] },
    ])
  })

  it('deletes a single id', async () => {
    await store.delete('2')
    expect(await store.count()).toBe(2)
  })

  it('deletes multiple ids in one call', async () => {
    await store.delete(['1', '3'])
    expect(await store.count()).toBe(1)
    const hits = await store.query({ vector: [0, 1, 0], topK: 5 })
    expect(hits.map((h) => h.id)).toEqual(['2'])
  })

  it('silently ignores unknown ids', async () => {
    await store.delete('missing')
    expect(await store.count()).toBe(3)
  })

  it('deleteAll clears the store', async () => {
    await store.deleteAll()
    expect(await store.count()).toBe(0)
  })
})

// ── RagService ────────────────────────────────────────────────────────────

describe('RagService.index', () => {
  let provider: FakeProvider
  let store: InMemoryVectorStore
  let rag: RagService

  beforeEach(() => {
    provider = new FakeProvider()
    store = new InMemoryVectorStore()
    rag = new RagService(provider, store)
  })

  it('embeds all documents in a single batched call', async () => {
    await rag.index([
      { id: '1', content: 'hello' },
      { id: '2', content: 'world' },
      { id: '3', content: 'foo' },
    ])

    expect(provider.embedCalls).toHaveLength(1)
    expect(provider.embedCalls[0]).toEqual(['hello', 'world', 'foo'])
    expect(await store.count()).toBe(3)
  })

  it('skips documents with empty or whitespace content', async () => {
    await rag.index([
      { id: '1', content: 'hello' },
      { id: '2', content: '' },
      { id: '3', content: '   ' },
      { id: '4', content: 'world' },
    ])

    expect(provider.embedCalls[0]).toEqual(['hello', 'world'])
    expect(await store.count()).toBe(2)
  })

  it('is a no-op when every input is empty', async () => {
    await rag.index([
      { id: '1', content: '' },
      { id: '2', content: '' },
    ])
    expect(provider.embedCalls).toHaveLength(0)
    expect(await store.count()).toBe(0)
  })

  it('preserves metadata through the embedding pipeline', async () => {
    await rag.index([
      { id: '1', content: 'hello', metadata: { author: 'alice' } },
    ])

    const hits = await store.query({ vector: embedString('hello'), topK: 1 })
    expect(hits[0].metadata).toEqual({ author: 'alice' })
  })
})

describe('RagService.search', () => {
  let provider: FakeProvider
  let store: InMemoryVectorStore
  let rag: RagService

  beforeEach(async () => {
    provider = new FakeProvider()
    store = new InMemoryVectorStore()
    rag = new RagService(provider, store)
    await rag.index([
      { id: '1', content: 'The quick brown fox' },
      { id: '2', content: 'Lazy dogs sleeping' },
      { id: '3', content: 'Brown foxes are clever' },
    ])
  })

  it('embeds the query once and delegates to the store', async () => {
    provider.embedCalls.length = 0 // reset from index calls above

    const hits = await rag.search('brown fox', { topK: 2 })
    expect(provider.embedCalls).toHaveLength(1)
    expect(provider.embedCalls[0]).toEqual(['brown fox'])
    expect(hits).toHaveLength(2)
  })

  it('forwards filter + minScore to the store', async () => {
    const hits = await rag.search('brown fox', { topK: 5, minScore: -1 })
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(-1)
  })
})

describe('RagService.augmentChatInput', () => {
  let provider: FakeProvider
  let store: InMemoryVectorStore
  let rag: RagService

  beforeEach(async () => {
    provider = new FakeProvider()
    store = new InMemoryVectorStore()
    rag = new RagService(provider, store)
    await rag.index([
      { id: 'kickjs-modules', content: 'KickJS modules implement AppModule' },
      { id: 'kickjs-dsl', content: 'KickJS uses decorators for DI' },
      { id: 'unrelated', content: 'Completely unrelated content' },
    ])
  })

  it('injects retrieved documents into the first system message (merge mode)', async () => {
    const input: ChatInput = {
      messages: [
        { role: 'system', content: 'You are a KickJS helper.' },
        { role: 'user', content: 'How do I define a module?' },
      ],
    }

    const augmented = await rag.augmentChatInput(input, 'How do I define a module?', {
      topK: 2,
    })

    // Original input is untouched
    expect(input.messages).toHaveLength(2)

    // Augmented has the same length (merged into existing system)
    expect(augmented.messages).toHaveLength(2)
    const systemMsg = augmented.messages[0]
    expect(systemMsg.role).toBe('system')
    expect(systemMsg.content).toContain('You are a KickJS helper.')
    expect(systemMsg.content).toContain('[Document 1')
    expect(systemMsg.content).toContain('KickJS')
  })

  it('prepends a new system message when no system exists', async () => {
    const input: ChatInput = {
      messages: [{ role: 'user', content: 'How do I define a module?' }],
    }

    const augmented = await rag.augmentChatInput(input, 'module', { topK: 2 })

    expect(augmented.messages).toHaveLength(2)
    expect(augmented.messages[0].role).toBe('system')
    expect(augmented.messages[0].content).toContain('[Document 1')
    expect(augmented.messages[1].role).toBe('user')
  })

  it('inserts a separate system message when asSeparateSystemMessage is true', async () => {
    const input: ChatInput = {
      messages: [
        { role: 'system', content: 'Existing prompt' },
        { role: 'user', content: 'q' },
      ],
    }

    const augmented = await rag.augmentChatInput(input, 'q', {
      topK: 1,
      asSeparateSystemMessage: true,
    })

    expect(augmented.messages).toHaveLength(3)
    expect(augmented.messages[0].role).toBe('system')
    expect(augmented.messages[0].content).toContain('[Document 1')
    expect(augmented.messages[1].content).toBe('Existing prompt')
    expect(augmented.messages[2].role).toBe('user')
  })

  it('returns the input unchanged when no documents are retrieved', async () => {
    await store.deleteAll()

    const input: ChatInput = {
      messages: [{ role: 'user', content: 'anything' }],
    }

    const augmented = await rag.augmentChatInput(input, 'anything')
    expect(augmented).toStrictEqual(input)
  })

  it('honors a custom systemTemplate', async () => {
    const input: ChatInput = {
      messages: [{ role: 'user', content: 'q' }],
    }

    const augmented = await rag.augmentChatInput(input, 'q', {
      topK: 1,
      systemTemplate: 'CONTEXT:\n{documents}\nEND',
    })

    expect(augmented.messages[0].content).toMatch(/^CONTEXT:/)
    expect(augmented.messages[0].content).toContain('END')
    expect(augmented.messages[0].content).toContain('[Document 1')
  })
})
