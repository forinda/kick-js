/**
 * Tests for the chat memory primitives.
 *
 * Three layers:
 *   1. `InMemoryChatMemory` — add, get, clear, size, mutation isolation
 *   2. `SlidingWindowChatMemory` — cap enforcement, pinned system
 *      prompt, composability with any inner memory
 *   3. `AiAdapter.runAgentWithMemory` — first-turn system prompt
 *      injection, follow-up persistence, tool-result filtering
 *
 * Memory-only tests use the `InMemoryChatMemory` directly. The
 * agent-with-memory tests reuse the `ScriptedProvider` from the
 * ai-adapter suite by declaring a local copy — it's small enough
 * not to warrant a shared helper file.
 *
 * @module @forinda/kickjs-ai/__tests__/memory.test
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  AiAdapter,
  InMemoryChatMemory,
  SlidingWindowChatMemory,
  type AiProvider,
  type ChatInput,
  type ChatMemory,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type EmbedInput,
} from '@forinda/kickjs-ai'

// ── Scripted provider (copy from ai-adapter.test for isolation) ──────────

class ScriptedProvider implements AiProvider {
  readonly name = 'scripted'
  public inputs: ChatInput[] = []
  private readonly queue: ChatResponse[]

  constructor(responses: ChatResponse[]) {
    this.queue = [...responses]
  }

  async chat(input: ChatInput, _options?: ChatOptions): Promise<ChatResponse> {
    // Snapshot the messages array so later mutations by the agent loop
    // don't corrupt the captured input. `runAgent` reuses the same
    // messages array across iterations, pushing results after each
    // call returns — if we stored the raw reference, post-hoc test
    // assertions would see the final state instead of what the
    // provider actually saw for THIS call.
    this.inputs.push({ ...input, messages: [...input.messages] })
    const next = this.queue.shift()
    if (!next) throw new Error('ScriptedProvider: no more responses scripted')
    return next
  }

  // eslint-disable-next-line require-yield
  async *stream(_input: ChatInput, _options?: ChatOptions) {
    throw new Error('not used')
  }

  async embed(_input: EmbedInput): Promise<number[][]> {
    throw new Error('not used')
  }
}

// ── InMemoryChatMemory ───────────────────────────────────────────────────

describe('InMemoryChatMemory', () => {
  let memory: InMemoryChatMemory

  beforeEach(() => {
    memory = new InMemoryChatMemory()
  })

  it('reports its backend name as "in-memory"', () => {
    expect(memory.name).toBe('in-memory')
  })

  it('starts empty', async () => {
    expect(await memory.get()).toEqual([])
    expect(await memory.size()).toBe(0)
  })

  it('adds a single message', async () => {
    await memory.add({ role: 'user', content: 'hi' })
    expect(await memory.size()).toBe(1)
    expect(await memory.get()).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('adds multiple messages in a single call', async () => {
    await memory.add([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
    expect(await memory.size()).toBe(3)
    expect((await memory.get()).map((m) => m.content)).toEqual(['first', 'second', 'third'])
  })

  it('preserves insertion order across multiple add calls', async () => {
    await memory.add({ role: 'user', content: 'a' })
    await memory.add({ role: 'assistant', content: 'b' })
    await memory.add({ role: 'user', content: 'c' })
    expect((await memory.get()).map((m) => m.content)).toEqual(['a', 'b', 'c'])
  })

  it('clear removes every message', async () => {
    await memory.add([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ])
    await memory.clear()
    expect(await memory.get()).toEqual([])
    expect(await memory.size()).toBe(0)
  })

  it('get returns a copy so external mutation does not leak in', async () => {
    await memory.add({ role: 'user', content: 'hi' })
    const snapshot = await memory.get()
    snapshot.push({ role: 'user', content: 'injected' })
    // Internal state should not reflect the mutation
    expect(await memory.size()).toBe(1)
    expect((await memory.get()).map((m) => m.content)).toEqual(['hi'])
  })
})

// ── SlidingWindowChatMemory ──────────────────────────────────────────────

describe('SlidingWindowChatMemory — construction', () => {
  it('requires an inner memory', () => {
    expect(
      () => new SlidingWindowChatMemory({ inner: undefined as unknown as ChatMemory, maxMessages: 5 }),
    ).toThrow(/inner.*required/)
  })

  it('requires a positive integer maxMessages', () => {
    const inner = new InMemoryChatMemory()
    expect(
      () => new SlidingWindowChatMemory({ inner, maxMessages: 0 }),
    ).toThrow(/maxMessages/)
    expect(
      () => new SlidingWindowChatMemory({ inner, maxMessages: -1 }),
    ).toThrow(/maxMessages/)
    expect(
      () => new SlidingWindowChatMemory({ inner, maxMessages: 2.5 }),
    ).toThrow(/maxMessages/)
  })

  it('exposes a descriptive name that references the inner backend', () => {
    const inner = new InMemoryChatMemory()
    const wrapped = new SlidingWindowChatMemory({ inner, maxMessages: 10 })
    expect(wrapped.name).toBe('sliding-window(in-memory)')
  })
})

describe('SlidingWindowChatMemory — eviction', () => {
  let inner: InMemoryChatMemory

  beforeEach(() => {
    inner = new InMemoryChatMemory()
  })

  it('keeps every message when count is under the cap', async () => {
    const wrapped = new SlidingWindowChatMemory({ inner, maxMessages: 10 })
    await wrapped.add([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ])
    expect((await wrapped.get()).map((m) => m.content)).toEqual(['a', 'b', 'c'])
  })

  it('evicts the oldest non-system messages when count exceeds the cap', async () => {
    const wrapped = new SlidingWindowChatMemory({ inner, maxMessages: 3 })
    await wrapped.add([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
      { role: 'assistant', content: 'fourth' },
      { role: 'user', content: 'fifth' },
    ])
    const visible = await wrapped.get()
    expect(visible.map((m) => m.content)).toEqual(['third', 'fourth', 'fifth'])
    // Eager eviction: the inner store is also trimmed
    expect(await inner.size()).toBe(3)
  })

  it('pins the first system message by default', async () => {
    const wrapped = new SlidingWindowChatMemory({ inner, maxMessages: 3 })
    await wrapped.add([
      { role: 'system', content: 'PERSONA' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ])
    const visible = await wrapped.get()
    expect(visible.map((m) => m.content)).toEqual(['PERSONA', 'c', 'd'])
  })

  it('does not pin when pinSystemPrompt is false', async () => {
    const wrapped = new SlidingWindowChatMemory({
      inner,
      maxMessages: 3,
      pinSystemPrompt: false,
    })
    await wrapped.add([
      { role: 'system', content: 'PERSONA' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ])
    const visible = await wrapped.get()
    expect(visible.map((m) => m.content)).toEqual(['b', 'c', 'd'])
  })

  it('clear wipes the inner store', async () => {
    const wrapped = new SlidingWindowChatMemory({ inner, maxMessages: 10 })
    await wrapped.add([{ role: 'user', content: 'a' }])
    await wrapped.clear()
    expect(await wrapped.get()).toEqual([])
    expect(await inner.size()).toBe(0)
  })

  it('size delegates to the inner memory when available', async () => {
    const wrapped = new SlidingWindowChatMemory({ inner, maxMessages: 10 })
    await wrapped.add([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ])
    expect(await wrapped.size()).toBe(2)
  })
})

// ── AiAdapter.runAgentWithMemory ─────────────────────────────────────────

describe('AiAdapter.runAgentWithMemory', () => {
  it('persists the system prompt and user message on the first turn', async () => {
    const provider = new ScriptedProvider([
      { content: 'Nice to meet you.', finishReason: 'stop' },
    ])
    const adapter = new AiAdapter({ provider })
    adapter.beforeStart({ container: { registerFactory: () => {}, registerInstance: () => {} } } as never)
    const memory = new InMemoryChatMemory()

    const result = await adapter.runAgentWithMemory({
      memory,
      userMessage: 'hello',
      systemPrompt: 'You are a helpful assistant.',
    })

    expect(result.content).toBe('Nice to meet you.')

    const stored = await memory.get()
    expect(stored.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Nice to meet you.' },
    ])
  })

  it('skips the system prompt on follow-up turns', async () => {
    const provider = new ScriptedProvider([
      { content: 'First reply', finishReason: 'stop' },
      { content: 'Second reply', finishReason: 'stop' },
    ])
    const adapter = new AiAdapter({ provider })
    adapter.beforeStart({ container: { registerFactory: () => {}, registerInstance: () => {} } } as never)
    const memory = new InMemoryChatMemory()

    await adapter.runAgentWithMemory({
      memory,
      userMessage: 'first',
      systemPrompt: 'You are helpful.',
    })

    // Second turn — different systemPrompt should be ignored
    await adapter.runAgentWithMemory({
      memory,
      userMessage: 'second',
      systemPrompt: 'IGNORED ON SECOND TURN',
    })

    const stored = await memory.get()
    const systemMessages = stored.filter((m) => m.role === 'system')
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0].content).toBe('You are helpful.')
    expect(stored.map((m) => m.content)).toEqual([
      'You are helpful.',
      'first',
      'First reply',
      'second',
      'Second reply',
    ])
  })

  it('sends the full history to the provider on each turn', async () => {
    const provider = new ScriptedProvider([
      { content: 'one', finishReason: 'stop' },
      { content: 'two', finishReason: 'stop' },
      { content: 'three', finishReason: 'stop' },
    ])
    const adapter = new AiAdapter({ provider })
    adapter.beforeStart({ container: { registerFactory: () => {}, registerInstance: () => {} } } as never)
    const memory = new InMemoryChatMemory()

    await adapter.runAgentWithMemory({ memory, userMessage: 'hi 1' })
    await adapter.runAgentWithMemory({ memory, userMessage: 'hi 2' })
    await adapter.runAgentWithMemory({ memory, userMessage: 'hi 3' })

    // Third call should see all previous user/assistant pairs
    const thirdInput = provider.inputs[2]
    const roles = thirdInput.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
  })

  it('drops tool messages from memory by default', async () => {
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'NoTool', arguments: {} },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'done', finishReason: 'stop' },
    ])
    const adapter = new AiAdapter({ provider })
    adapter.beforeStart({ container: { registerFactory: () => {}, registerInstance: () => {} } } as never)
    const memory = new InMemoryChatMemory()

    await adapter.runAgentWithMemory({
      memory,
      userMessage: 'do a thing',
      tools: 'auto',
    })

    const roles = (await memory.get()).map((m) => m.role)
    // Should have: user, assistant (with tool calls), assistant (final text)
    // but NOT the tool result message
    expect(roles).toEqual(['user', 'assistant', 'assistant'])
  })

  it('persists tool messages when persistToolResults is true', async () => {
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'NoTool', arguments: {} },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'done', finishReason: 'stop' },
    ])
    const adapter = new AiAdapter({ provider })
    adapter.beforeStart({ container: { registerFactory: () => {}, registerInstance: () => {} } } as never)
    const memory = new InMemoryChatMemory()

    await adapter.runAgentWithMemory({
      memory,
      userMessage: 'do a thing',
      tools: 'auto',
      persistToolResults: true,
    })

    const roles = (await memory.get()).map((m) => m.role)
    // Tool message IS included
    expect(roles).toContain('tool')
  })

  it('works with a SlidingWindowChatMemory wrapper', async () => {
    const provider = new ScriptedProvider([
      { content: 'reply 1', finishReason: 'stop' },
      { content: 'reply 2', finishReason: 'stop' },
      { content: 'reply 3', finishReason: 'stop' },
    ])
    const adapter = new AiAdapter({ provider })
    adapter.beforeStart({ container: { registerFactory: () => {}, registerInstance: () => {} } } as never)

    const memory = new SlidingWindowChatMemory({
      inner: new InMemoryChatMemory(),
      maxMessages: 4,
      pinSystemPrompt: true,
    })

    await adapter.runAgentWithMemory({
      memory,
      userMessage: 'q1',
      systemPrompt: 'You are helpful.',
    })
    await adapter.runAgentWithMemory({ memory, userMessage: 'q2' })
    await adapter.runAgentWithMemory({ memory, userMessage: 'q3' })

    // Window = 4, system is pinned. Latest 3 non-system slots = [q2 reply,
    // q3 user, q3 assistant]; system + 3 latest = 4.
    const final = await memory.get()
    expect(final[0].content).toBe('You are helpful.')
    expect(final.length).toBeLessThanOrEqual(4)
    const last: ChatMessage = final[final.length - 1]
    expect(last.content).toBe('reply 3')
  })
})
