import { createToken } from '@forinda/kickjs'
import type { VectorStore } from './rag/types'
import type { AiProvider, AiToolOptions } from './types'

/**
 * Metadata key for the `@AiTool` decorator.
 *
 * Using `createToken` for metadata keys (rather than a raw `Symbol`)
 * gives a collision-safe, type-carrying identifier: the phantom type
 * parameter flows through `getMethodMetaOrUndefined` so consumers get
 * `AiToolOptions` back without a manual cast, and reference-equality
 * guarantees that two separate definitions can never shadow each other
 * even if the package is loaded more than once.
 */
export const AI_TOOL_METADATA = createToken<AiToolOptions>('kickjs.ai.tool')

/**
 * DI token for the active AI provider.
 *
 * Injected via `@Inject(AI_PROVIDER)` in services or use-cases that
 * need to call an LLM. The adapter registers the concrete provider
 * (OpenAI, Anthropic, Google, Ollama) during `beforeStart`.
 *
 * @example
 * ```ts
 * @Service()
 * export class SummarizeService {
 *   constructor(@Inject(AI_PROVIDER) private ai: AiProvider) {}
 *
 *   async summarize(text: string) {
 *     const res = await this.ai.chat({
 *       messages: [
 *         { role: 'system', content: 'Summarize in 2 sentences.' },
 *         { role: 'user', content: text },
 *       ],
 *     })
 *     return res.content
 *   }
 * }
 * ```
 */
export const AI_PROVIDER = createToken<AiProvider>('kickjs.ai.provider')

/**
 * DI token for the active vector store backend.
 *
 * Injected via `@Inject(VECTOR_STORE)` in services that need
 * retrieval-augmented generation. The adapter does not register a
 * default — users bind the backend they want at bootstrap time,
 * typically `InMemoryVectorStore` for development/tests and
 * `PgVectorStore` / `QdrantStore` / `PineconeStore` for production.
 *
 * @example
 * ```ts
 * import { bootstrap, getEnv } from '@forinda/kickjs'
 * import { AiAdapter, InMemoryVectorStore, VECTOR_STORE } from '@forinda/kickjs-ai'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [
 *     new AiAdapter({
 *       provider: new OpenAIProvider({ apiKey: getEnv('OPENAI_API_KEY') }),
 *     }),
 *   ],
 *   plugins: [
 *     {
 *       name: 'vector-store',
 *       register: (container) => {
 *         container.registerInstance(VECTOR_STORE, new InMemoryVectorStore())
 *       },
 *     },
 *   ],
 * })
 * ```
 */
export const VECTOR_STORE = createToken<VectorStore>('kickjs.ai.vector_store')
