import { createToken } from '@forinda/kickjs'
import type { VectorStore } from './rag/types'
import type { AiAdapterInstance, AiProvider, AiToolOptions } from './types'

/**
 * Metadata key for the `@AiTool` decorator.
 *
 * Using `createToken` for metadata keys (rather than a raw `Symbol` or
 * a bare string) gives a collision-safe, type-carrying identifier: the
 * phantom type parameter flows through `getMethodMetaOrUndefined` so
 * consumers get `AiToolOptions` back without a manual cast, and the
 * reserved `kick/` prefix prevents two separate definitions from
 * shadowing each other even if the package is loaded more than once.
 */
export const AI_TOOL_METADATA = createToken<AiToolOptions>('kick/ai/tool')

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
export const AI_PROVIDER = createToken<AiProvider>('kick/ai/provider')

/**
 * DI token for the AiAdapter instance — exposes the agent loop (`runAgent`,
 * `runAgentWithMemory`) and tool inspection (`getTools`, `getProvider`).
 *
 * Injected via `@Inject(AI_ADAPTER)` in services that need to dispatch
 * tool-calling agent loops. The adapter registers itself under this
 * token during `beforeStart`. Use {@link AI_PROVIDER} when you only
 * need the raw `chat` / `embed` calls and don't need agent loops.
 *
 * @example
 * ```ts
 * @Service()
 * export class AgentService {
 *   constructor(@Inject(AI_ADAPTER) private ai: AiAdapterInstance) {}
 *
 *   async handleQuery(prompt: string) {
 *     const result = await this.ai.runAgent({
 *       messages: [{ role: 'user', content: prompt }],
 *       tools: 'auto',
 *     })
 *     return result.content
 *   }
 * }
 * ```
 */
export const AI_ADAPTER = createToken<AiAdapterInstance>('kick/ai/adapter')

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
 *     AiAdapter({
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
export const VECTOR_STORE = createToken<VectorStore>('kick/ai/vector-store')
