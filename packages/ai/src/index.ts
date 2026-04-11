export { AiAdapter } from './ai.adapter'
export { AiTool, getAiToolMeta, isAiTool } from './decorators'
export { AI_PROVIDER, AI_TOOL_METADATA, VECTOR_STORE } from './constants'
export { OpenAIProvider, type OpenAIProviderOptions } from './providers/openai'
export { ProviderError } from './providers/base'
export {
  InMemoryVectorStore,
  PgVectorStore,
  RagService,
  buildWhereClause,
  cosineSimilarity,
  toPgVector,
} from './rag'
export type {
  PgVectorStoreOptions,
  RagAugmentOptions,
  RagIndexInput,
  RagSearchOptions,
  SqlExecutor,
  VectorDocument,
  VectorQueryOptions,
  VectorSearchHit,
  VectorStore,
} from './rag'
export type {
  AiProvider,
  AiAdapterOptions,
  AiToolOptions,
  AiToolDefinition,
  ChatInput,
  ChatOptions,
  ChatResponse,
  ChatChunk,
  ChatMessage,
  ChatToolDefinition,
  EmbedInput,
  RunAgentOptions,
  RunAgentResult,
  ToolCallInput,
  ToolCallResponse,
} from './types'
