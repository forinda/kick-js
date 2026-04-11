import type { ChatMessage } from '../types'

/**
 * Chat memory contract.
 *
 * Memory is the persistence layer for multi-turn conversations. The
 * agent loop inside `runAgent` maintains history WITHIN a single call,
 * but a real chatbot needs to remember what the user said in their
 * previous request — that's the job of this interface.
 *
 * Every backend (in-memory, sliding window, Drizzle, Redis) implements
 * this same contract, so swapping storage is a DI binding change and
 * nothing else. Services stay identical regardless of whether memory
 * lives in a `Map`, a Postgres row, or a Redis list.
 *
 * ### Session scoping
 *
 * The interface has no session concept itself — every `ChatMemory`
 * instance is implicitly scoped to one conversation. Services that
 * serve multiple users construct one memory instance per session,
 * typically via a factory bound to the request scope or a
 * `sessionId` parameter on the backend.
 *
 * @typeParam M — optional metadata attached to every stored message.
 *   Most backends ignore this; Drizzle and Redis stores can use it
 *   for timestamps, speaker IDs, or audit info.
 *
 * @module @forinda/kickjs-ai/memory/types
 */
export interface ChatMemory {
  /** Short identifier for logs and debug UIs. */
  readonly name: string

  /**
   * Return the full message history in chronological order.
   *
   * The returned array should be safe to pass directly into
   * `provider.chat({ messages })` — backends are responsible for
   * returning the shape the framework expects without requiring
   * callers to transform it.
   */
  get(): Promise<ChatMessage[]>

  /**
   * Append one or more messages to the history.
   *
   * Backends should persist in insertion order. Arrays are accepted
   * for efficiency — storing a batch in one round-trip is faster
   * than N individual calls for most real databases.
   */
  add(message: ChatMessage | ChatMessage[]): Promise<void>

  /**
   * Drop every message from this session.
   *
   * Called by the /chat/reset route pattern and by tests between
   * cases. Backends that persist to an external store should commit
   * the clear transactionally so partial deletes can't happen.
   */
  clear(): Promise<void>

  /**
   * Optional: return the number of stored messages. Not every
   * backend can compute this cheaply — Redis lists and in-memory
   * arrays can, Drizzle can via COUNT(*), but long-tail stores may
   * decline. Callers should treat `undefined` returns as "unknown".
   */
  size?(): Promise<number>
}

/**
 * Options for `AiAdapter.runAgentWithMemory()`.
 *
 * The helper wraps `runAgent` with an automatic "read history →
 * append user message → run loop → persist assistant response" cycle
 * so services don't have to manage the plumbing themselves. Most
 * real chatbots end up writing this wrapper anyway; shipping it in
 * the framework saves everyone that boilerplate.
 */
export interface RunAgentWithMemoryOptions {
  /** Memory backend for this conversation. Typically scoped to a request or session. */
  memory: ChatMemory
  /** The user's message for this turn. */
  userMessage: string
  /**
   * System prompt to prepend IF the memory is empty — i.e. it's the
   * first turn of the conversation. Skipped on subsequent turns so
   * the model sees a single, stable system prompt for the session.
   */
  systemPrompt?: string
  /** Model override. Defaults to the provider's configured default. */
  model?: string
  /**
   * Tools the agent can call. Defaults to `'auto'` — every tool in
   * the adapter's `@AiTool` registry.
   */
  tools?: 'auto' | import('../types').ChatToolDefinition[]
  /** Maximum chat → tool-call → dispatch cycles per turn. Defaults to 8. */
  maxSteps?: number
  /** Runtime chat options passed through to the provider. */
  temperature?: number
  maxTokens?: number
  topP?: number
  stopSequences?: string[]
  signal?: AbortSignal
  /**
   * When true, tool call results written to memory preserve their
   * full content. When false (the default), tool results are
   * dropped from memory on the grounds that they're usually large
   * API responses the user doesn't need to see on a later turn.
   * Turn this on for debugging sessions or full-transcript replay.
   */
  persistToolResults?: boolean
}
