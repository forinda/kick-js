import type { VectorDocument, VectorQueryOptions, VectorSearchHit, VectorStore } from './types'

/**
 * Options for `QdrantVectorStore`.
 *
 * Qdrant exposes a REST API under `/collections/{name}` — this store
 * talks to it directly with `fetch`, so no client SDK is needed. A
 * bearer `apiKey` is optional because self-hosted Qdrant instances
 * often run without auth; managed Qdrant Cloud always requires one.
 */
export interface QdrantVectorStoreOptions {
  /** Base URL of the Qdrant HTTP API. Defaults to `http://localhost:6333`. */
  url?: string
  /** API key sent as `api-key` header. Optional for local/self-hosted. */
  apiKey?: string
  /** Collection name. Required — Qdrant does not have a default collection. */
  collection: string
  /** Vector dimensionality. Must match the embedding model. Required. */
  dimensions: number
  /**
   * Distance metric for the collection on first create. Qdrant supports
   * `Cosine`, `Dot`, `Euclid`, and `Manhattan`. Defaults to `'Cosine'`
   * since that's what every OpenAI/Anthropic-compatible embedding
   * model ships.
   */
  distance?: 'Cosine' | 'Dot' | 'Euclid' | 'Manhattan'
  /**
   * Skip the first-use collection bootstrap. Turn this on if the
   * collection is managed by your infra team or provisioned via
   * Terraform, and the runtime role doesn't have create permission.
   */
  skipSetup?: boolean
  /** Provider name override. Defaults to `'qdrant'`. */
  name?: string
}

/**
 * Qdrant REST API response for `/collections/{name}/points/search`.
 *
 * Narrowed to the fields we consume — Qdrant's full response also
 * carries vector data (optional), version info, and payload schema,
 * none of which the store needs to surface.
 */
interface QdrantSearchResult {
  result: Array<{
    id: string | number
    score: number
    payload?: {
      content?: string
      metadata?: Record<string, unknown>
    }
  }>
}

/**
 * Qdrant-backed `VectorStore` implementation.
 *
 * Qdrant stores vectors as "points" inside a named "collection". Each
 * point has an id, a dense vector, and an arbitrary JSON "payload" —
 * the store uses the payload to carry both the original `content`
 * string (so RAG retrieval can feed text back to the LLM) and the
 * `metadata` record.
 *
 * ### Filtering
 *
 * The framework's equality-map filter (`{ key: value }` or
 * `{ key: [v1, v2] }`) is translated into Qdrant's `filter.must`
 * conditions against `payload.metadata.<key>`. Scalar values become
 * `match: { value }`, arrays become `match: { any: [...] }`. Users
 * who need richer queries (nested, range, should/must_not) can bypass
 * this by extending the class, but equality covers the 90% case.
 *
 * ### Lazy collection creation
 *
 * On first write, the store calls `PUT /collections/{name}` with
 * `vectors: { size, distance }` — idempotent, so it's safe to run on
 * every boot. Pass `skipSetup: true` if your cluster is provisioned
 * externally and the runtime API key doesn't have create permission.
 *
 * @example
 * ```ts
 * import { bootstrap, getEnv } from '@forinda/kickjs'
 * import { AiAdapter, QdrantVectorStore, VECTOR_STORE } from '@forinda/kickjs-ai'
 *
 * const store = new QdrantVectorStore({
 *   url: getEnv('QDRANT_URL'),
 *   apiKey: getEnv('QDRANT_API_KEY'),
 *   collection: 'docs',
 *   dimensions: 1536,
 * })
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [new AiAdapter({ provider })],
 *   plugins: [
 *     {
 *       name: 'qdrant',
 *       register: (container) => {
 *         container.registerInstance(VECTOR_STORE, store)
 *       },
 *     },
 *   ],
 * })
 * ```
 */
export class QdrantVectorStore<
  M extends Record<string, unknown> = Record<string, unknown>,
> implements VectorStore<M> {
  readonly name: string

  private readonly url: string
  private readonly collection: string
  private readonly dimensions: number
  private readonly distance: 'Cosine' | 'Dot' | 'Euclid' | 'Manhattan'
  private readonly headers: Record<string, string>
  private readonly skipSetup: boolean
  /**
   * Cached bootstrap promise. The first method call triggers collection
   * creation; every subsequent call awaits the same promise so the
   * check happens exactly once per process. On failure we clear the
   * cache so the next call can retry (networks blink, DNS flaps).
   */
  private setupPromise: Promise<void> | null = null

  constructor(options: QdrantVectorStoreOptions) {
    if (!options.collection) {
      throw new Error('QdrantVectorStore: collection is required')
    }
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error('QdrantVectorStore: dimensions must be a positive integer')
    }
    this.url = (options.url ?? 'http://localhost:6333').replace(/\/$/, '')
    this.collection = options.collection
    this.dimensions = options.dimensions
    this.distance = options.distance ?? 'Cosine'
    this.skipSetup = options.skipSetup ?? false
    this.name = options.name ?? 'qdrant'
    this.headers = {
      'content-type': 'application/json',
      ...(options.apiKey ? { 'api-key': options.apiKey } : {}),
    }
  }

  async upsert(doc: VectorDocument<M> | VectorDocument<M>[]): Promise<void> {
    const list = Array.isArray(doc) ? doc : [doc]
    if (list.length === 0) return

    for (const d of list) {
      if (!d.id) throw new Error('QdrantVectorStore.upsert: document id is required')
      if (!Array.isArray(d.vector) || d.vector.length !== this.dimensions) {
        throw new Error(
          `QdrantVectorStore.upsert: vector length ${d.vector?.length ?? 0} ` +
            `does not match collection dimensions ${this.dimensions} (id=${d.id})`,
        )
      }
    }

    await this.ensureCollection()

    const points = list.map((d) => ({
      id: d.id,
      vector: d.vector,
      payload: {
        content: d.content,
        metadata: d.metadata ?? {},
      },
    }))

    await this.request('PUT', `/collections/${this.collection}/points?wait=true`, {
      points,
    })
  }

  async query(options: VectorQueryOptions): Promise<VectorSearchHit<M>[]> {
    if (!Array.isArray(options.vector) || options.vector.length === 0) {
      throw new Error('QdrantVectorStore.query: vector is required')
    }
    if (options.vector.length !== this.dimensions) {
      throw new Error(
        `QdrantVectorStore.query: vector length ${options.vector.length} ` +
          `does not match collection dimensions ${this.dimensions}`,
      )
    }

    await this.ensureCollection()

    const topK = options.topK ?? 5
    const minScore = options.minScore

    const body: Record<string, unknown> = {
      vector: options.vector,
      limit: topK,
      with_payload: true,
    }
    if (options.filter && Object.keys(options.filter).length > 0) {
      body.filter = buildQdrantFilter(options.filter)
    }
    if (minScore !== undefined) {
      body.score_threshold = minScore
    }

    const data = await this.request<QdrantSearchResult>(
      'POST',
      `/collections/${this.collection}/points/search`,
      body,
    )

    return data.result.map((hit) => ({
      id: String(hit.id),
      content: hit.payload?.content ?? '',
      score: hit.score,
      metadata: (hit.payload?.metadata ?? {}) as M,
    }))
  }

  async delete(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return

    await this.ensureCollection()

    await this.request('POST', `/collections/${this.collection}/points/delete?wait=true`, {
      points: ids,
    })
  }

  async deleteAll(): Promise<void> {
    // Qdrant doesn't have a "truncate points" endpoint — the canonical
    // way is to drop and recreate the collection. Recreating is cheap
    // since the schema is declarative, and it's the same operation the
    // Qdrant web UI performs on "clear collection".
    await this.request('DELETE', `/collections/${this.collection}`, undefined)
    // Force a fresh setup next call so the collection reappears.
    this.setupPromise = null
    if (!this.skipSetup) {
      await this.ensureCollection()
    }
  }

  async count(): Promise<number> {
    await this.ensureCollection()
    const data = await this.request<{ result: { count: number } }>(
      'POST',
      `/collections/${this.collection}/points/count`,
      { exact: true },
    )
    return data.result.count
  }

  // ── Internal: HTTP plumbing ──────────────────────────────────────────

  /**
   * Thin wrapper around `fetch` that applies the shared headers, JSON
   * encodes the body, and maps non-2xx responses to `Error` instances
   * with the response body attached for debugging. Matches the shape
   * used by `providers/base.ts`, kept local here so the RAG module has
   * no dependency on the provider internals.
   */
  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`QdrantVectorStore: ${method} ${path} failed with ${res.status}: ${text}`)
    }
    // Some endpoints (DELETE collection) return JSON; some return empty
    // body. Parse defensively so callers that don't need the payload
    // can still await the promise without hitting a JSON error.
    const text = await res.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined as T
    }
  }

  /**
   * Create the collection on first use. The `PUT /collections/{name}`
   * endpoint is idempotent — calling it on an existing collection is a
   * no-op with status 200. We cache the promise so concurrent callers
   * share the same in-flight request and every subsequent call resolves
   * immediately.
   */
  private ensureCollection(): Promise<void> {
    if (this.skipSetup) return Promise.resolve()
    this.setupPromise ??= this.runSetup().catch((err) => {
      // Clear the cache on failure so a later call can retry — network
      // blips shouldn't permanently wedge the store.
      this.setupPromise = null
      throw err
    })
    return this.setupPromise
  }

  private async runSetup(): Promise<void> {
    await this.request('PUT', `/collections/${this.collection}`, {
      vectors: {
        size: this.dimensions,
        distance: this.distance,
      },
    })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Translate the framework's equality-map filter into Qdrant's
 * `must` condition format.
 *
 * Scalars become `{ key, match: { value } }`. Arrays become
 * `{ key, match: { any: [...] } }`. Keys are interpreted as paths into
 * `payload.metadata`, matching how `upsert` nests the metadata record.
 *
 * Exported so tests (and future richer filter builders) can verify the
 * translation without going through a live Qdrant instance.
 */
export function buildQdrantFilter(filter: Record<string, unknown>): {
  must: Array<Record<string, unknown>>
} {
  const must: Array<Record<string, unknown>> = []
  for (const [key, value] of Object.entries(filter)) {
    const qdrantKey = `metadata.${key}`
    if (Array.isArray(value)) {
      must.push({ key: qdrantKey, match: { any: value } })
    } else {
      must.push({ key: qdrantKey, match: { value } })
    }
  }
  return { must }
}
