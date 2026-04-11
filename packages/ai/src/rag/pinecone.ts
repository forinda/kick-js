import type { VectorDocument, VectorQueryOptions, VectorSearchHit, VectorStore } from './types'

/**
 * Options for `PineconeVectorStore`.
 *
 * Unlike Qdrant, Pinecone does not have a "create collection on first
 * use" endpoint that's cheap to call — the index must be provisioned
 * separately (via the Pinecone dashboard, API, or Terraform) before
 * the store can use it. Every Pinecone index has its own hostname,
 * which the SDK normally looks up; this store requires the caller to
 * pass it directly via `indexHost` so there's zero runtime dependency
 * on the Pinecone client.
 */
export interface PineconeVectorStoreOptions {
  /** Required API key, sent as `Api-Key` header. */
  apiKey: string
  /**
   * Fully qualified hostname for the Pinecone index, e.g.
   * `my-index-abcdef1.svc.us-east-1-aws.pinecone.io`. Find it in
   * the Pinecone dashboard or via the `describe_index` API. The
   * scheme is optional — the store adds `https://` if it's missing.
   */
  indexHost: string
  /**
   * Namespace for all operations. Pinecone partitions indexes with
   * namespaces; omitting this uses the default (empty) namespace.
   * Most multi-tenant apps use one namespace per tenant.
   */
  namespace?: string
  /** Vector dimensionality. Required — used to validate upsert shapes. */
  dimensions: number
  /** Provider name override. Defaults to `'pinecone'`. */
  name?: string
}

/**
 * Pinecone REST API response for `POST /query`.
 *
 * Narrowed to the fields we consume. Pinecone's full response also
 * includes `namespace` and `usage` objects; the store ignores them
 * because neither is needed to produce framework-shape hits.
 */
interface PineconeQueryResult {
  matches: Array<{
    id: string
    score: number
    metadata?: Record<string, unknown> & { content?: string }
  }>
}

/**
 * Pinecone-backed `VectorStore` implementation.
 *
 * Pinecone stores vectors with a flat id, a dense vector, and an
 * arbitrary metadata object. Like Qdrant the store uses metadata to
 * carry both the original `content` (for RAG retrieval) and the
 * application's own metadata fields — they're merged into one
 * Pinecone metadata record at write time and split back apart at
 * read time.
 *
 * ### Filtering
 *
 * Pinecone has a native filter DSL that looks almost identical to
 * MongoDB's — `{ key: { $eq: value } }`, `{ key: { $in: [...] } }`,
 * etc. The framework's equality-map filter is translated directly:
 * scalars become `$eq` and arrays become `$in`. Users who need the
 * full DSL (range, $ne, $or) can pass a raw Pinecone filter through
 * the same `filter` field — the translator is a no-op when the keys
 * start with `$`, so advanced filters pass through unchanged.
 *
 * ### Index provisioning
 *
 * Pinecone indexes must be created out-of-band. This store does NOT
 * provision indexes automatically — the dimensionality, metric, and
 * pod type are infrastructure decisions that should live in
 * Terraform or the Pinecone dashboard, not in runtime code.
 *
 * @example
 * ```ts
 * import { bootstrap, getEnv } from '@forinda/kickjs'
 * import { AiAdapter, PineconeVectorStore, VECTOR_STORE } from '@forinda/kickjs-ai'
 *
 * const store = new PineconeVectorStore({
 *   apiKey: getEnv('PINECONE_API_KEY'),
 *   indexHost: getEnv('PINECONE_INDEX_HOST'),
 *   dimensions: 1536,
 *   namespace: 'docs',
 * })
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [new AiAdapter({ provider })],
 *   plugins: [
 *     {
 *       name: 'pinecone',
 *       register: (container) => {
 *         container.registerInstance(VECTOR_STORE, store)
 *       },
 *     },
 *   ],
 * })
 * ```
 */
export class PineconeVectorStore<
  M extends Record<string, unknown> = Record<string, unknown>,
> implements VectorStore<M> {
  readonly name: string

  private readonly baseURL: string
  private readonly namespace: string | undefined
  private readonly dimensions: number
  private readonly headers: Record<string, string>

  constructor(options: PineconeVectorStoreOptions) {
    if (!options.apiKey) {
      throw new Error('PineconeVectorStore: apiKey is required')
    }
    if (!options.indexHost) {
      throw new Error('PineconeVectorStore: indexHost is required')
    }
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error('PineconeVectorStore: dimensions must be a positive integer')
    }

    // Accept hosts with or without a scheme — the Pinecone dashboard
    // shows them bare, but developers often paste the full URL.
    const host = options.indexHost.replace(/\/$/, '')
    this.baseURL = host.startsWith('http') ? host : `https://${host}`
    this.namespace = options.namespace
    this.dimensions = options.dimensions
    this.name = options.name ?? 'pinecone'
    this.headers = {
      'content-type': 'application/json',
      'Api-Key': options.apiKey,
      // Pinecone pins clients to a stable API version via this header.
      // 2024-10 is the current GA version; bump when Pinecone ships a
      // new stable release and users need the new fields.
      'X-Pinecone-API-Version': '2024-10',
    }
  }

  async upsert(doc: VectorDocument<M> | VectorDocument<M>[]): Promise<void> {
    const list = Array.isArray(doc) ? doc : [doc]
    if (list.length === 0) return

    for (const d of list) {
      if (!d.id) throw new Error('PineconeVectorStore.upsert: document id is required')
      if (!Array.isArray(d.vector) || d.vector.length !== this.dimensions) {
        throw new Error(
          `PineconeVectorStore.upsert: vector length ${d.vector?.length ?? 0} ` +
            `does not match index dimensions ${this.dimensions} (id=${d.id})`,
        )
      }
    }

    const vectors = list.map((d) => ({
      id: d.id,
      values: d.vector,
      // Pinecone flattens `content` + user metadata into one record
      // because Pinecone doesn't support nested objects in metadata.
      // We unflatten on read — see `query` below.
      metadata: {
        content: d.content,
        ...(d.metadata ?? {}),
      },
    }))

    const body: Record<string, unknown> = { vectors }
    if (this.namespace) body.namespace = this.namespace

    await this.request('/vectors/upsert', body)
  }

  async query(options: VectorQueryOptions): Promise<VectorSearchHit<M>[]> {
    if (!Array.isArray(options.vector) || options.vector.length === 0) {
      throw new Error('PineconeVectorStore.query: vector is required')
    }
    if (options.vector.length !== this.dimensions) {
      throw new Error(
        `PineconeVectorStore.query: vector length ${options.vector.length} ` +
          `does not match index dimensions ${this.dimensions}`,
      )
    }

    const topK = options.topK ?? 5

    const body: Record<string, unknown> = {
      vector: options.vector,
      topK,
      includeMetadata: true,
    }
    if (this.namespace) body.namespace = this.namespace
    if (options.filter && Object.keys(options.filter).length > 0) {
      body.filter = buildPineconeFilter(options.filter)
    }

    const data = await this.request<PineconeQueryResult>('/query', body)

    const minScore = options.minScore ?? -Infinity
    return data.matches
      .filter((m) => m.score >= minScore)
      .map((match) => {
        const { content, ...metadata } = match.metadata ?? {}
        return {
          id: match.id,
          content: typeof content === 'string' ? content : '',
          score: match.score,
          metadata: metadata as M,
        }
      })
  }

  async delete(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return

    const body: Record<string, unknown> = { ids }
    if (this.namespace) body.namespace = this.namespace

    await this.request('/vectors/delete', body)
  }

  async deleteAll(): Promise<void> {
    // Pinecone exposes `deleteAll: true` inside the namespace to wipe
    // the whole namespace in a single call.
    const body: Record<string, unknown> = { deleteAll: true }
    if (this.namespace) body.namespace = this.namespace
    await this.request('/vectors/delete', body)
  }

  async count(): Promise<number> {
    const data = await this.request<{
      namespaces?: Record<string, { vectorCount: number }>
      totalVectorCount?: number
    }>('/describe_index_stats', this.namespace ? { filter: {} } : {})

    if (this.namespace) {
      return data.namespaces?.[this.namespace]?.vectorCount ?? 0
    }
    return data.totalVectorCount ?? 0
  }

  // ── Internal: HTTP plumbing ──────────────────────────────────────────

  /**
   * POST a JSON body to the Pinecone data-plane and return the parsed
   * JSON response. Every Pinecone data-plane endpoint uses POST even
   * for reads (`/query`, `/describe_index_stats`), so the helper
   * doesn't bother parameterizing the method.
   */
  private async request<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`PineconeVectorStore: POST ${path} failed with ${res.status}: ${text}`)
    }
    const text = await res.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined as T
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Translate the framework's equality-map filter into Pinecone's
 * MongoDB-style filter DSL.
 *
 * Rules:
 *   - Scalar value           → `{ key: { $eq: value } }`
 *   - Array value            → `{ key: { $in: [...] } }`
 *   - Key that starts with $ → passed through untouched, letting
 *     callers hand-craft `{ $or: [...] }` or range conditions
 *     without the translator mangling them
 *   - Value already shaped like `{ $eq, $in, $gt, ... }` → passed
 *     through untouched for the same reason
 *
 * Exported so tests can verify the translation offline.
 */
export function buildPineconeFilter(filter: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('$')) {
      // Top-level operators (`$and`, `$or`) — user knows what they're doing.
      result[key] = value
      continue
    }
    if (isOperatorRecord(value)) {
      result[key] = value
      continue
    }
    if (Array.isArray(value)) {
      result[key] = { $in: value }
    } else {
      result[key] = { $eq: value }
    }
  }
  return result
}

function isOperatorRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (key.startsWith('$')) return true
  }
  return false
}
