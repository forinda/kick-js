/**
 * Chat memory primitives for multi-turn conversations.
 *
 * Two layers:
 *   - `ChatMemory` — the backend-agnostic interface (get / add / clear)
 *   - `InMemoryChatMemory` — zero-dep concrete implementation
 *   - `SlidingWindowChatMemory` — wrapper that caps history at N messages
 *
 * Services consume memory through DI — the framework ships the
 * interface and the in-memory backend; persistent backends
 * (Drizzle, Redis, Postgres) land as dedicated classes in follow-up
 * commits. Services that bind `ChatMemory` don't change when the
 * backend swaps.
 *
 * @module @forinda/kickjs-ai/memory
 */

export { InMemoryChatMemory } from './in-memory'
export { SlidingWindowChatMemory } from './sliding-window'
export type { SlidingWindowChatMemoryOptions } from './sliding-window'
export type { ChatMemory, RunAgentWithMemoryOptions } from './types'
