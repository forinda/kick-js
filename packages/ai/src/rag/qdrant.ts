import { createHash } from 'node:crypto'
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
      id?: string
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
 *   adapters: [AiAdapter({ provider })],
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

  /** `/collections/{name}`, with the name URL-encoded. */
  private get collectionPath(): string {
    return `/collections/${encodeURIComponent(this.collection)}`
  }

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
      id: toPointId(d.id),
      vector: d.vector,
      payload: {
        // Qdrant ids are UUIDs or integers; the document's own id is kept here.
        id: d.id,
        content: d.content,
        metadata: d.metadata ?? {},
      },
    }))

    await this.request('PUT', `${this.collectionPath}/points?wait=true`, {
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
      `${this.collectionPath}/points/search`,
      body,
    )

    return data.result.map((hit) => ({
      id: hit.payload?.id ?? String(hit.id),
      content: hit.payload?.content ?? '',
      score: hit.score,
      metadata: (hit.payload?.metadata ?? {}) as M,
    }))
  }

  async delete(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return

    await this.ensureCollection()

    await this.request('POST', `${this.collectionPath}/points/delete?wait=true`, {
      points: ids.map(toPointId),
    })
  }

  /**
   * Delete every point, keeping the collection and its configuration — so
   * it also works on a collection this store did not create (`skipSetup`).
   */
  async deleteAll(): Promise<void> {
    await this.ensureCollection()
    // An empty filter matches every point.
    await this.request('POST', `${this.collectionPath}/points/delete?wait=true`, { filter: {} })
  }

  async count(): Promise<number> {
    await this.ensureCollection()
    const data = await this.request<{ result: { count: number } }>(
      'POST',
      `${this.collectionPath}/points/count`,
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
    const init: RequestInit = {
      method,
      headers: this.headers,
    }
    // GET requests must not have a body — guard at construction time
    // so the fetch call doesn't trip the runtime / lint rule when a
    // caller mistakenly passes a body.
    if (method !== 'GET' && body !== undefined) {
      init.body = JSON.stringify(body)
    }
    const res = await fetch(`${this.url}${path}`, init)
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
   * Create the collection on first use if it doesn't exist yet. Creating an
   * existing collection is an error in Qdrant, so a restarted process checks
   * first. The promise is cached so concurrent callers share one check.
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
    const existing = await fetch(`${this.url}${this.collectionPath}`, { headers: this.headers })
    if (existing.ok) return
    if (existing.status !== 404) {
      const text = await existing.text().catch(() => '')
      throw new Error(
        `QdrantVectorStore: GET ${this.collectionPath} failed with ${existing.status}: ${text}`,
      )
    }
    await this.request('PUT', this.collectionPath, {
      vectors: {
        size: this.dimensions,
        distance: this.distance,
      },
    })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Namespace for document ids that are not UUIDs (fixed, so ids map the same way every run). */
const DOCUMENT_ID_NAMESPACE = Buffer.from('6f1c2d8e4b9a4c7e9f3a2b1d0c5e7a84', 'hex')

/**
 * A Qdrant point id for a document id. Qdrant accepts only UUIDs and
 * unsigned integers, so any other id (`'doc-1'`) becomes a deterministic
 * UUIDv5 — the same document id always maps to the same point.
 */
export function toPointId(id: string): string {
  if (UUID.test(id)) return id
  const hash = createHash('sha1').update(DOCUMENT_ID_NAMESPACE).update(id).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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
