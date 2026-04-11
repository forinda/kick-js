/**
 * Retrieval-augmented generation (RAG) primitives for KickJS.
 *
 * Two pieces, independent but designed to compose:
 *
 *   - `VectorStore` — a backend-agnostic interface for storing
 *     embeddings. Ships with `InMemoryVectorStore` (zero deps, good
 *     for tests and prototypes). Production backends (pgvector,
 *     Qdrant, Pinecone) ship in follow-up commits under the same
 *     interface, so swapping is a DI binding change.
 *
 *   - `RagService` — a thin orchestrator that ties an `AiProvider`
 *     (for embeddings) to a `VectorStore` (for retrieval) and
 *     provides `index`, `search`, and `augmentChatInput` helpers.
 *     Services that want RAG-powered chat call
 *     `rag.augmentChatInput(input, query)` and hand the result back
 *     to `provider.chat()`.
 *
 * @module @forinda/kickjs-ai/rag
 */

export { InMemoryVectorStore, cosineSimilarity } from './in-memory'
export { PgVectorStore, toPgVector, buildWhereClause } from './pgvector'
export type { PgVectorStoreOptions, SqlExecutor } from './pgvector'
export { QdrantVectorStore, buildQdrantFilter } from './qdrant'
export type { QdrantVectorStoreOptions } from './qdrant'
export { PineconeVectorStore, buildPineconeFilter } from './pinecone'
export type { PineconeVectorStoreOptions } from './pinecone'
export { RagService } from './rag-service'
export type {
  VectorStore,
  VectorDocument,
  VectorSearchHit,
  VectorQueryOptions,
  RagIndexInput,
  RagSearchOptions,
  RagAugmentOptions,
} from './types'
