/**
 * Structured output — `chat({ messages, schema })` answers with JSON that
 * matches `schema`, parsed and validated into `response.object`.
 *
 * Providers send the schema their own way (OpenAI `response_format`,
 * Anthropic a forced tool call) and hand the raw answer back here. An answer
 * that isn't JSON or doesn't validate is sent back to the model with what was
 * wrong, `schemaRetries` times (default 1), before {@link StructuredOutputError}.
 */
import { detectSchema, isKickSchema, type InferSchemaOutput } from '@forinda/kickjs-schema'
import type { AiProvider, ChatInput, ChatMessage, ChatOptions, ChatResponse } from './types'

/** `stream()` can't validate a whole answer as it arrives. */
export const SCHEMA_STREAM_ERROR =
  'schema is supported by chat(), not stream() — an answer is validated once it is complete.'

/** The model's structured answer didn't match the schema, even after retries. */
export class StructuredOutputError extends Error {
  constructor(
    /** What was wrong with the last answer. */
    readonly issues: string[],
    /** The last answer as the model gave it. */
    readonly raw: unknown,
  ) {
    super(`The model's answer didn't match the schema: ${issues.join('; ')}`)
    this.name = 'StructuredOutputError'
  }
}

/** A schema ready to send and to check answers against. */
export interface OutputSchema {
  name: string
  /** Always an object at the root — what both APIs require. */
  jsonSchema: Record<string, unknown>
  /** The schema wasn't an object, so it travels as `{ value: … }`; unwrap answers. */
  wrapped: boolean
  validate(value: unknown): { ok: true; data: unknown } | { ok: false; issues: string[] }
}

/** A plain JSON Schema object — sent as is; answers are only checked to be JSON. */
function isJsonSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    !('~standard' in v) &&
    typeof v.safeParse !== 'function' &&
    typeof v.validateSync !== 'function' &&
    ('type' in v || 'properties' in v || '$schema' in v || 'anyOf' in v || 'oneOf' in v)
  )
}

export function outputSchema(schema: unknown, name = 'response'): OutputSchema {
  if (isJsonSchema(schema) && !isKickSchema(schema)) {
    return { name, ...rooted(schema), validate: (value) => ({ ok: true, data: value }) }
  }
  const kick = detectSchema(schema)
  const jsonSchema = { ...kick.toJsonSchema({ io: 'output' }) }
  delete jsonSchema.$schema // providers want the schema itself, not its dialect marker
  return {
    name,
    ...rooted(jsonSchema),
    validate(value) {
      const result = kick.safeParse(value)
      return result.success
        ? { ok: true, data: result.data }
        : {
            ok: false,
            issues: result.issues.map((i) =>
              i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message,
            ),
          }
    },
  }
}

/** An object schema as is; anything else (an array, a string) inside `{ value }`. */
function rooted(schema: Record<string, unknown>): {
  jsonSchema: Record<string, unknown>
  wrapped: boolean
} {
  if (schema.type === 'object') return { jsonSchema: schema, wrapped: false }
  return {
    jsonSchema: {
      type: 'object',
      properties: { value: schema },
      required: ['value'],
      additionalProperties: false,
    },
    wrapped: true,
  }
}

/**
 * Whether OpenAI's strict mode accepts the schema: every object lists all its
 * properties as required and allows no others. Strict guarantees the shape;
 * a schema that isn't strict-compatible is still sent, just not strictly.
 */
export function isStrictCompatible(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(isStrictCompatible)
  if (!node || typeof node !== 'object') return true
  const n = node as Record<string, unknown>
  if (n.type === 'object' || n.properties) {
    const props = Object.keys((n.properties as Record<string, unknown>) ?? {})
    const required = new Set((n.required as string[]) ?? [])
    if (n.additionalProperties !== false || props.some((p) => !required.has(p))) return false
  }
  return Object.values(n).every(isStrictCompatible)
}

/**
 * Run a structured call: `send` makes one provider call and returns the
 * response with the answer it carries (already-parsed object, or JSON text).
 * Retries with the issues on a bad answer; returns the response with
 * `object` set, or throws {@link StructuredOutputError}.
 */
export async function chatWithSchema(
  input: ChatInput,
  schema: OutputSchema,
  send: (input: ChatInput) => Promise<{ response: ChatResponse; answer: unknown }>,
): Promise<ChatResponse> {
  const retries = input.schemaRetries ?? 1
  // One copy for the whole loop; corrections are appended to it, not to the caller's array.
  const messages = [...input.messages]
  for (let attempt = 0; ; attempt++) {
    // A snapshot per attempt: a later correction mustn't change what an earlier attempt sent.
    const { response, answer } = await send({ ...input, messages: messages.slice() })
    // A refusal or a cut-off answer isn't the model getting the shape wrong.
    if (response.finishReason === 'content_filter' || response.finishReason === 'length') {
      return response
    }
    let value: unknown = answer
    let issues: string[]
    if (typeof answer === 'string') {
      try {
        value = JSON.parse(answer)
      } catch {
        value = undefined
      }
    }
    if (schema.wrapped && value !== undefined) {
      value =
        value && typeof value === 'object' && 'value' in value
          ? (value as { value: unknown }).value
          : undefined
    }
    if (value === undefined) {
      issues = [
        schema.wrapped
          ? 'the answer was not JSON of the form { "value": … }'
          : 'the answer was not valid JSON',
      ]
    } else {
      const checked = schema.validate(value)
      if (checked.ok) return { ...response, object: checked.data }
      issues = checked.issues
    }
    if (attempt >= retries) throw new StructuredOutputError(issues, answer)
    const said = typeof answer === 'string' ? answer : JSON.stringify(answer)
    const correction: ChatMessage[] = [
      { role: 'assistant', content: said ?? '' },
      {
        role: 'user',
        content:
          `That answer doesn't match the required schema:\n- ${issues.join('\n- ')}\n` +
          'Answer again with JSON that matches it exactly.',
      },
    ]
    messages.push(...correction)
  }
}

/**
 * `chat()` with a schema, returning just the validated answer, typed from the
 * schema:
 *
 * ```ts
 * const Advice = z.object({ summary: z.string(), steps: z.array(z.string()) })
 * const advice = await chatObject(ai.getProvider(), {
 *   messages: [{ role: 'user', content: 'How do I rotate my API keys?' }],
 *   schema: Advice,
 * })
 * advice.steps // string[]
 * ```
 */
export async function chatObject<S>(
  provider: Pick<AiProvider, 'chat'>,
  input: ChatInput & { schema: S },
  options?: ChatOptions,
): Promise<InferSchemaOutput<S>> {
  const res = await provider.chat(input, options)
  // A refusal or a cut-off answer comes back without an object.
  if (res.object === undefined) {
    throw new StructuredOutputError(
      [
        res.refusal
          ? `the model declined: ${res.refusal.explanation ?? res.refusal.category ?? 'no reason given'}`
          : `no answer (finish reason: ${res.finishReason ?? 'unknown'})`,
      ],
      res.content,
    )
  }
  return res.object as InferSchemaOutput<S>
}
