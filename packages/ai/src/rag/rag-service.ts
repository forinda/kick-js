import type { AiProvider, ChatInput, ChatMessage } from '../types'
import type {
  RagAugmentOptions,
  RagIndexInput,
  RagSearchOptions,
  VectorDocument,
  VectorSearchHit,
  VectorStore,
} from './types'

const DEFAULT_SYSTEM_TEMPLATE =
  'You have access to the following context documents. Use them when they are' +
  ' relevant to the user question; ignore them otherwise.\n\n' +
  '{documents}\n\n' +
  "If the context doesn't contain enough information, say so plainly — don't" +
  ' invent answers.'

/**
 * High-level RAG helper that ties an `AiProvider` (for embeddings)
 * to a `VectorStore` (for retrieval) and produces the three operations
 * every RAG-powered service needs: index documents, search by query,
 * and augment a chat input with retrieved context.
 *
 * The service itself is a thin orchestrator — all the storage and
 * model calls go through the injected interfaces, so swapping
 * backends (in-memory → pgvector, OpenAI → Ollama) is a DI binding
 * change, not a code change.
 *
 * @example
 * ```ts
 * import { Service, Autowired, Inject } from '@forinda/kickjs'
 * import { AI_PROVIDER, VECTOR_STORE, RagService } from '@forinda/kickjs-ai'
 * import type { AiProvider, VectorStore } from '@forinda/kickjs-ai'
 *
 * @Service()
 * class DocsService {
 *   private readonly rag: RagService
 *
 *   constructor(
 *     @Inject(AI_PROVIDER) provider: AiProvider,
 *     @Inject(VECTOR_STORE) store: VectorStore,
 *   ) {
 *     this.rag = new RagService(provider, store)
 *   }
 *
 *   async ingest(articles: Array<{ id: string; body: string }>) {
 *     await this.rag.index(articles.map((a) => ({ id: a.id, content: a.body })))
 *   }
 *
 *   async ask(question: string) {
 *     const input = await this.rag.augmentChatInput(
 *       { messages: [{ role: 'user', content: question }] },
 *       question,
 *       { topK: 3 },
 *     )
 *     const res = await provider.chat(input)
 *     return res.content
 *   }
 * }
 * ```
 */
export class RagService<M extends Record<string, unknown> = Record<string, unknown>> {
  constructor(
    private readonly provider: AiProvider,
    private readonly store: VectorStore<M>,
  ) {}

  /** Underlying provider — exposed for services that want to reuse it for chat. */
  getProvider(): AiProvider {
    return this.provider
  }

  /** Underlying store — useful for admin tools that want raw access. */
  getStore(): VectorStore<M> {
    return this.store
  }

  /**
   * Index a batch of documents: embed each one's content via the
   * provider, then upsert into the store. Embedding happens in a
   * single batched call, which is both faster and cheaper than one
   * call per document for most providers.
   *
   * Documents with empty content are skipped rather than failing the
   * whole batch — the store can't meaningfully retrieve empty strings
   * and silently dropping them matches what users usually expect when
   * a content field turns out to be blank.
   */
  async index(docs: RagIndexInput<M>[]): Promise<void> {
    const nonEmpty = docs.filter((d) => d.content && d.content.trim().length > 0)
    if (nonEmpty.length === 0) return

    const vectors = await this.provider.embed(nonEmpty.map((d) => d.content))
    if (vectors.length !== nonEmpty.length) {
      throw new Error(
        `RagService.index: provider returned ${vectors.length} vectors for ${nonEmpty.length} inputs`,
      )
    }

    const toUpsert: VectorDocument<M>[] = nonEmpty.map((doc, i) => ({
      id: doc.id,
      content: doc.content,
      vector: vectors[i],
      metadata: doc.metadata,
    }))

    await this.store.upsert(toUpsert)
  }

  /**
   * Search the store for documents relevant to a natural-language
   * query. Embeds the query once, then delegates to the store's
   * `query` method with the resolved vector.
   */
  async search(query: string, options: RagSearchOptions = {}): Promise<VectorSearchHit<M>[]> {
    const [queryVector] = await this.provider.embed(query)
    if (!queryVector) return []

    return this.store.query({
      vector: queryVector,
      topK: options.topK ?? 5,
      filter: options.filter,
      minScore: options.minScore,
    })
  }

  /**
   * Retrieve relevant documents for a query and inject them into a
   * `ChatInput` as a system message. Returns a new input — the
   * original is not mutated.
   *
   * Two injection modes:
   *   - Merge (default): prepend the context to the first existing
   *     system message if one exists, otherwise add a new one. Avoids
   *     producing chat histories with competing system prompts.
   *   - Separate (`asSeparateSystemMessage: true`): always insert a
   *     new system message at the start. Useful when the existing
   *     system prompt is small and you want to keep roles distinct.
   *
   * If no documents are retrieved, the input is returned unchanged.
   */
  async augmentChatInput(
    input: ChatInput,
    query: string,
    options: RagAugmentOptions = {},
  ): Promise<ChatInput> {
    const hits = await this.search(query, {
      topK: options.topK ?? 5,
      filter: options.filter,
      minScore: options.minScore,
    })
    if (hits.length === 0) return input

    const template = options.systemTemplate ?? DEFAULT_SYSTEM_TEMPLATE
    const documentBlock = hits
      .map((h, i) => `[Document ${i + 1} (id=${h.id}, score=${h.score.toFixed(3)})]\n${h.content}`)
      .join('\n\n')
    const contextMessage = template.replace('{documents}', documentBlock)

    // Rebuild the messages array with the context injected. Never
    // mutate the caller's input — ChatInput can be reused across
    // multiple provider calls and mutation would lead to compounding
    // context on each retry.
    const newMessages: ChatMessage[] = []

    const existingSystemIdx = input.messages.findIndex((m) => m.role === 'system')
    const shouldMerge = !options.asSeparateSystemMessage && existingSystemIdx !== -1

    if (shouldMerge) {
      for (let i = 0; i < input.messages.length; i++) {
        const msg = input.messages[i]
        if (i === existingSystemIdx) {
          newMessages.push({
            ...msg,
            content: `${contextMessage}\n\n---\n\n${msg.content}`,
          })
        } else {
          newMessages.push(msg)
        }
      }
    } else {
      newMessages.push({ role: 'system', content: contextMessage })
      newMessages.push(...input.messages)
    }

    return { ...input, messages: newMessages }
  }
}
