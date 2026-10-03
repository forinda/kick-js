import type {
  AiProvider,
  ChatChunk,
  ChatInput,
  ChatOptions,
  ChatResponse,
  EmbedInput,
  EmbedOptions,
} from './types'

/** A scripted turn: a fixed response, or one computed from the input. */
export type ScriptedTurn = ChatResponse | ((input: ChatInput) => ChatResponse)

/**
 * An `AiProvider` for tests: answers each `chat()` / `stream()` call with
 * the next scripted turn and records every input, so a test can drive
 * `runAgent` through tool calls without a model.
 *
 * @example
 * ```ts
 * const provider = new ScriptedProvider([
 *   { content: '', toolCalls: [{ id: 'c1', name: 'TasksController_list', arguments: {} }] },
 *   { content: 'You have 2 tasks.', finishReason: 'stop' },
 * ])
 * const result = await ai.runAgent({ provider, messages: [{ role: 'user', content: 'tasks?' }] })
 * expect(provider.inputs[1].messages.at(-1)).toMatchObject({ role: 'tool' })
 * ```
 */
export class ScriptedProvider implements AiProvider {
  readonly name: string
  /** Every chat/stream input received, in order (deep copies). */
  readonly inputs: ChatInput[] = []
  /** The options of each call, alongside `inputs`. */
  readonly chatOptions: ChatOptions[] = []
  private readonly turns: ScriptedTurn[]

  constructor(
    turns: ScriptedTurn[],
    private readonly options: {
      name?: string
      /** Vectors for `embed()`; without it, `embed()` throws. */
      embed?: (texts: string[]) => number[][]
    } = {},
  ) {
    this.turns = [...turns]
    this.name = options.name ?? 'scripted'
  }

  /** Turns not used yet. */
  get remaining(): number {
    return this.turns.length
  }

  async chat(input: ChatInput, options: ChatOptions = {}): Promise<ChatResponse> {
    this.inputs.push(structuredClone(input))
    this.chatOptions.push(options)
    const turn = this.turns.shift()
    if (!turn)
      throw new Error(`ScriptedProvider: no scripted turn left (call ${this.inputs.length})`)
    return typeof turn === 'function' ? turn(input) : turn
  }

  /** Streams the next turn as its text, its tool calls, then a final chunk. */
  async *stream(input: ChatInput, options?: ChatOptions): AsyncIterable<ChatChunk> {
    const res = await this.chat(input, options)
    if (res.content) yield { content: res.content, done: false }
    for (const [index, call] of (res.toolCalls ?? []).entries()) {
      yield {
        content: '',
        done: false,
        toolCallDelta: {
          id: call.id,
          index,
          name: call.name,
          argumentsDelta: JSON.stringify(call.arguments),
        },
      }
    }
    yield {
      content: '',
      done: true,
      ...(res.finishReason ? { finishReason: res.finishReason } : {}),
      ...(res.usage ? { usage: res.usage } : {}),
    }
  }

  async embed(input: EmbedInput, _options?: EmbedOptions): Promise<number[][]> {
    if (!this.options.embed) throw new Error('ScriptedProvider: pass `embed` to use embeddings')
    return this.options.embed(Array.isArray(input) ? input : [input])
  }
}
