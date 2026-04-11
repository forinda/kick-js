import type { VectorDocument, VectorQueryOptions, VectorSearchHit, VectorStore } from './types'

/**
 * Zero-dependency in-memory vector store.
 *
 * Backed by a plain `Map<string, VectorDocument>` with a linear-scan
 * cosine-similarity search. Perfect for tests, prototypes, CLI tools,
 * and any project with a bounded corpus (roughly < 10k documents
 * before the scan starts taking more than a handful of milliseconds).
 *
 * For production workloads with larger corpora, swap in the pgvector,
 * Qdrant, or Pinecone store — the `VectorStore` interface is the same,
 * so services that consume `VECTOR_STORE` don't need to change.
 *
 * @example
 * ```ts
 * import { InMemoryVectorStore, VECTOR_STORE } from '@forinda/kickjs-ai'
 *
 * container.registerInstance(VECTOR_STORE, new InMemoryVectorStore())
 * ```
 *
 * The class is entirely synchronous under the hood but wraps each
 * method in a Promise so it matches the async interface every other
 * backend implements. This keeps the calling code uniform regardless
 * of which backend is wired in.
 */
export class InMemoryVectorStore<
  M extends Record<string, unknown> = Record<string, unknown>,
> implements VectorStore<M> {
  readonly name = 'in-memory'

  private readonly docs = new Map<string, VectorDocument<M>>()

  async upsert(doc: VectorDocument<M> | VectorDocument<M>[]): Promise<void> {
    const list = Array.isArray(doc) ? doc : [doc]
    for (const d of list) {
      if (!d.id) throw new Error('InMemoryVectorStore.upsert: document id is required')
      if (!Array.isArray(d.vector)) {
        throw new Error(`InMemoryVectorStore.upsert: vector must be an array (id=${d.id})`)
      }
      // Shallow-copy so callers can't mutate stored state after the fact.
      this.docs.set(d.id, {
        id: d.id,
        content: d.content,
        vector: [...d.vector],
        metadata: d.metadata,
      })
    }
  }

  async query(options: VectorQueryOptions): Promise<VectorSearchHit<M>[]> {
    if (!Array.isArray(options.vector) || options.vector.length === 0) {
      throw new Error('InMemoryVectorStore.query: vector is required')
    }
    const topK = options.topK ?? 5
    const minScore = options.minScore ?? -Infinity
    const filter = options.filter

    const scored: VectorSearchHit<M>[] = []

    for (const doc of this.docs.values()) {
      if (filter && !matchesFilter(doc.metadata, filter)) continue

      const score = cosineSimilarity(options.vector, doc.vector)
      if (score < minScore) continue

      scored.push({
        id: doc.id,
        content: doc.content,
        score,
        metadata: doc.metadata,
      })
    }

    // Sort descending by score; ties broken by id for deterministic ordering.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.id.localeCompare(b.id)
    })

    return scored.slice(0, topK)
  }

  async delete(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    for (const i of ids) this.docs.delete(i)
  }

  async deleteAll(): Promise<void> {
    this.docs.clear()
  }

  async count(): Promise<number> {
    return this.docs.size
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors. Returns a value in [-1, 1]
 * where 1 means identical direction, 0 means orthogonal, -1 means
 * opposite. The function is symmetric and scale-invariant.
 *
 * Returns 0 for length mismatches or zero-magnitude vectors rather
 * than throwing — callers get a useless hit they can filter out via
 * `minScore`, but the store doesn't crash on bad input.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    dot += x * y
    magA += x * x
    magB += y * y
  }

  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

/**
 * Simple equality-based metadata filter. Every key in `filter` must
 * exist on the metadata and be strictly equal. Array values on the
 * filter are treated as an `IN` clause — the metadata value must be
 * one of the listed values.
 *
 * This covers 90% of metadata filtering use cases without pulling in
 * a query-language dependency. Backends that support richer filters
 * (pgvector's WHERE, Qdrant's conditions, Pinecone's filter DSL) can
 * pass through their native syntax via the same `filter` field,
 * since the type is `Record<string, unknown>`.
 */
function matchesFilter(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  if (!metadata) return false
  for (const [key, expected] of Object.entries(filter)) {
    const actual = metadata[key]
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}
