import type { ChatMessage } from '../types'
import type { ChatMemory } from './types'

/**
 * Options for `SlidingWindowChatMemory`.
 */
export interface SlidingWindowChatMemoryOptions {
  /** Underlying memory to wrap. */
  inner: ChatMemory
  /**
   * Maximum number of messages to keep in the sliding window. The
   * LAST `maxMessages` messages are retained; anything older is
   * dropped on every `get()` call and on every `add()` that pushes
   * the count past the cap.
   *
   * A typical value is 20 — enough for several user/assistant
   * exchanges with tool call overhead, short enough to keep prompt
   * tokens under control. Tune up or down based on model context
   * window and cost sensitivity.
   */
  maxMessages: number
  /**
   * Whether to treat the FIRST system message as pinned — i.e. never
   * evict it, even when the window would otherwise cap it out.
   *
   * This matches the common pattern of putting a single persona /
   * instruction prompt at the start of every conversation. Without
   * pinning, a long session would eventually drop the system prompt
   * and the model would lose its instructions.
   *
   * Defaults to `true` because forgetting the system prompt is
   * almost never what users want.
   */
  pinSystemPrompt?: boolean
}

/**
 * Sliding-window memory wrapper.
 *
 * Wraps any `ChatMemory` implementation with a bounded history: only
 * the most recent N messages survive. Older messages are evicted on
 * every `get()` and after every `add()` that pushes the count past
 * the cap. The first system message is pinned by default so long
 * sessions don't lose their persona.
 *
 * Use this to keep prompt token usage predictable without writing
 * eviction logic in every service. It composes with any backend —
 * in-memory, Drizzle, Redis — because it only touches the inner
 * memory through its public interface.
 *
 * @example
 * ```ts
 * import { InMemoryChatMemory, SlidingWindowChatMemory } from '@forinda/kickjs-ai'
 *
 * const memory = new SlidingWindowChatMemory({
 *   inner: new InMemoryChatMemory(),
 *   maxMessages: 20,
 *   pinSystemPrompt: true,
 * })
 * ```
 *
 * @remarks
 * Eviction writes back to the inner memory via `clear()` + `add()`.
 * That's fine for in-memory backends where clearing is O(1), but
 * costs a round-trip for network-backed stores. If you're wrapping
 * a remote backend, consider an inner memory that supports native
 * trimming — the wrapper's contract assumes clear+add is cheap.
 */
export class SlidingWindowChatMemory implements ChatMemory {
  readonly name: string
  private readonly inner: ChatMemory
  private readonly maxMessages: number
  private readonly pinSystemPrompt: boolean

  constructor(options: SlidingWindowChatMemoryOptions) {
    if (!options.inner) {
      throw new Error('SlidingWindowChatMemory: `inner` memory is required')
    }
    if (!Number.isInteger(options.maxMessages) || options.maxMessages <= 0) {
      throw new Error('SlidingWindowChatMemory: `maxMessages` must be a positive integer')
    }
    this.inner = options.inner
    this.maxMessages = options.maxMessages
    this.pinSystemPrompt = options.pinSystemPrompt ?? true
    this.name = `sliding-window(${options.inner.name})`
  }

  async get(): Promise<ChatMessage[]> {
    const raw = await this.inner.get()
    return this.applyWindow(raw)
  }

  async add(message: ChatMessage | ChatMessage[]): Promise<void> {
    await this.inner.add(message)
    // Trim eagerly after every add so subsequent gets see a bounded
    // history. Eager eviction keeps the stored state and the visible
    // state in sync — lazy eviction would leave the inner store
    // unbounded, which defeats the point of the wrapper for
    // persistent backends.
    const raw = await this.inner.get()
    const windowed = this.applyWindow(raw)
    if (windowed.length !== raw.length) {
      await this.inner.clear()
      await this.inner.add(windowed)
    }
  }

  async clear(): Promise<void> {
    await this.inner.clear()
  }

  async size(): Promise<number> {
    if (this.inner.size) return this.inner.size()
    const raw = await this.inner.get()
    return raw.length
  }

  /**
   * Apply the sliding window to an array of messages, returning the
   * bounded view. Pure function so both `get()` and `add()` can use
   * the same logic.
   *
   * When `pinSystemPrompt` is set and the first message is a system
   * message, we keep it AND fill the remaining `maxMessages - 1`
   * slots with the most recent messages after it. Otherwise we just
   * take the tail of the array.
   */
  private applyWindow(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= this.maxMessages) return messages

    if (this.pinSystemPrompt && messages[0]?.role === 'system') {
      const head = messages[0]
      const tail = messages.slice(-(this.maxMessages - 1))
      return [head, ...tail]
    }

    return messages.slice(-this.maxMessages)
  }
}
