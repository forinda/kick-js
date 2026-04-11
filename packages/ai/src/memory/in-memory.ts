import type { ChatMessage } from '../types'
import type { ChatMemory } from './types'

/**
 * Zero-dependency in-memory chat memory.
 *
 * Backed by a plain array. Each instance represents ONE conversation
 * — services that serve multiple sessions construct one instance per
 * session, typically via a `sessionId → memory` map in a parent
 * service or a request-scoped DI factory.
 *
 * Good for:
 *   - Tests and prototypes
 *   - Single-process CLI tools
 *   - Short-lived request handlers that don't outlive the HTTP response
 *
 * Not good for:
 *   - Multi-replica deployments (memory isn't shared across pods)
 *   - Sessions that need to survive a restart
 *   - Anything with a compliance retention policy
 *
 * For any of those, swap in a persistent backend (Drizzle, Redis,
 * Postgres) that implements the same `ChatMemory` interface — the
 * calling service doesn't change.
 *
 * @example
 * ```ts
 * import { InMemoryChatMemory } from '@forinda/kickjs-ai'
 *
 * const memory = new InMemoryChatMemory()
 * await memory.add({ role: 'user', content: 'hello' })
 * const history = await memory.get()
 * ```
 */
export class InMemoryChatMemory implements ChatMemory {
  readonly name = 'in-memory'

  private messages: ChatMessage[] = []

  async get(): Promise<ChatMessage[]> {
    // Return a shallow copy so callers can't mutate internal state
    // by pushing to the returned array. Important: ChatMessage.toolCalls
    // is an object — we don't deep-clone, so external mutation of
    // nested properties is still possible. Callers who need true
    // isolation should structuredClone the result themselves.
    return [...this.messages]
  }

  async add(message: ChatMessage | ChatMessage[]): Promise<void> {
    const list = Array.isArray(message) ? message : [message]
    for (const m of list) {
      this.messages.push(m)
    }
  }

  async clear(): Promise<void> {
    this.messages = []
  }

  async size(): Promise<number> {
    return this.messages.length
  }
}
