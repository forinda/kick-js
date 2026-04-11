/**
 * RAG primitive types.
 *
 * The `VectorStore` interface is the contract every backend (in-memory,
 * pgvector, Qdrant, Pinecone) implements. The framework's own `RagService`
 * takes any `VectorStore` + an `AiProvider` and produces retrieval-
 * augmented chat helpers, so swapping storage backends is a one-line
 * change to the DI binding — services that consume `VECTOR_STORE` stay
 * the same.
 *
 * The shapes here are deliberately minimal. Vendor-specific features
 * (hybrid search, reranking, sparse vectors) live on the concrete
 * implementations as extensions, not on this interface.
 *
 * @module @forinda/kickjs-ai/rag/types
 */

/**
 * A single document stored in a vector store.
 *
 * The `content` field carries the original text — the vector alone
 * isn't enough because RAG retrieval needs to feed the original text
 * back into the LLM context. `metadata` is the escape hatch for
 * anything the application wants to filter or track (author, date,
 * tags, tenant ID, etc.).
 *
 * @typeParam M — the metadata shape; defaults to a loose record so
 * users don't need to parameterize the type unless they want the
 * extra rigor.
 */
export interface VectorDocument<M extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique identifier — repeated upsert with the same id replaces the previous version. */
  id: string
  /** Original text the vector was computed from. */
  content: string
  /** Dense embedding. Length must match the store's configured dimensions. */
  vector: number[]
  /** Optional arbitrary metadata used for filtering and display. */
  metadata?: M
}

/**
 * A single search result from `VectorStore.query`.
 *
 * `score` is normalized across backends: higher = more similar.
 * Cosine similarity returns values in [-1, 1]; most backends clamp to
 * [0, 1] for usability. Services should treat the number as a
 * monotonic rank, not an absolute probability.
 */
export interface VectorSearchHit<M extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  content: string
  score: number
  metadata?: M
}

/**
 * Options for `VectorStore.query`.
 *
 * `filter` is an equality map against `metadata` — backends that
 * support richer predicates (range, $in, $not) should accept them
 * here as well, using the MongoDB-style operator prefix convention.
 * The in-memory store implements equality only, which is enough for
 * most v0 use cases.
 */
export interface VectorQueryOptions {
  /** The embedding of the query text. */
  vector: number[]
  /** Maximum number of hits to return. Defaults to 5. */
  topK?: number
  /** Metadata equality filter. Hits whose metadata doesn't match are dropped. */
  filter?: Record<string, unknown>
  /** Drop hits whose score falls below this threshold. */
  minScore?: number
}

/**
 * Vector store contract. Backends:
 *   - `InMemoryVectorStore` — in-package, zero deps, perfect for tests
 *     and prototypes; up to a few thousand docs before linear scan hurts
 *   - pgvector — runs inside any Postgres 13+ KickJS project (follow-up commit)
 *   - Qdrant — dedicated vector DB with payload filtering (follow-up commit)
 *   - Pinecone — managed cloud service (follow-up commit)
 *
 * Implementations must honor two contracts: upserts are idempotent on
 * id, and query results are ordered by descending score.
 */
export interface VectorStore<M extends Record<string, unknown> = Record<string, unknown>> {
  /** Short identifier for logs, e.g. `'in-memory'`, `'pgvector'`. */
  readonly name: string

  /**
   * Insert or replace one or more documents. Re-upserting an existing
   * id overwrites its vector, content, and metadata.
   */
  upsert(doc: VectorDocument<M> | VectorDocument<M>[]): Promise<void>

  /**
   * Search for the nearest vectors. Results are ordered by descending
   * score, capped at `options.topK` (default 5), and filtered by
   * `options.filter` / `options.minScore` if provided.
   */
  query(options: VectorQueryOptions): Promise<VectorSearchHit<M>[]>

  /** Remove documents by id. Missing ids are silently ignored. */
  delete(id: string | string[]): Promise<void>

  /** Clear every document from the store. Mostly for tests and admin tools. */
  deleteAll(): Promise<void>

  /** Optional count — not every backend supports it cheaply. */
  count?(): Promise<number>
}

/** Input to `RagService.index`. */
export interface RagIndexInput<M extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  content: string
  metadata?: M
}

/** Options for `RagService.search` / `RagService.augmentChatInput`. */
export interface RagSearchOptions {
  /** Maximum number of documents to retrieve. Defaults to 5. */
  topK?: number
  /** Metadata equality filter forwarded to the underlying store. */
  filter?: Record<string, unknown>
  /** Drop hits whose similarity score falls below this threshold. */
  minScore?: number
}

/** Options for `RagService.augmentChatInput`. */
export interface RagAugmentOptions extends RagSearchOptions {
  /**
   * Template for the retrieved-context system message. `{documents}`
   * is replaced with the concatenated document contents. If omitted,
   * a sensible default is used.
   */
  systemTemplate?: string
  /**
   * When true, prepend the context as a NEW system message. When false
   * (the default), merge into the first existing system message or
   * prepend if none exists. The merge path avoids producing chat
   * histories with two competing system prompts, which confuses models.
   */
  asSeparateSystemMessage?: boolean
}
