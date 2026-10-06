import type { KickSchema, SchemaResult, SchemaIssue, JsonSchemaOptions } from '../types.js'
import type { InferSchemaOutput } from '../infer.js'
import { warnUnsatisfiableInput } from './wire.js'

export function isZodSchema(schema: unknown): boolean {
  return (
    schema != null &&
    typeof schema === 'object' &&
    typeof (schema as any).safeParse === 'function' &&
    '_def' in (schema as any)
  )
}

function mapZodIssues(error: any): SchemaIssue[] {
  const issues: any[] = error?.issues ?? error?.errors ?? []
  return issues.map((issue: any) => {
    const mapped: SchemaIssue = {
      path: (issue.path ?? []).map(String),
      message: issue.message ?? 'Validation failed',
      code: issue.code ?? 'unknown',
    }
    if (issue.expected !== undefined) mapped.expected = String(issue.expected)
    if (issue.received !== undefined) mapped.received = String(issue.received)
    if (mapped.code === 'too_small' && issue.minimum !== undefined) {
      mapped.expected = `>=${issue.minimum}`
      if (issue.input !== undefined) mapped.received = String(issue.input)
    }
    if (mapped.code === 'too_big' && issue.maximum !== undefined) {
      mapped.expected = `<=${issue.maximum}`
      if (issue.input !== undefined) mapped.received = String(issue.input)
    }
    return mapped
  })
}

const ZOD_TARGETS = {
  'draft-07': 'draft-7',
  'draft-2020-12': 'draft-2020-12',
  'openapi-3.0': 'openapi-3.0',
} as const

function zodToJsonSchema(schema: any, options: JsonSchemaOptions = {}): Record<string, unknown> {
  if (typeof schema.toJSONSchema !== 'function') return { type: 'object' }
  const { $schema: _, ...rest } = schema.toJSONSchema({
    target: options.target && ZOD_TARGETS[options.target],
    io: options.io,
    // Zod throws on what JSON Schema can't express — a Map, a transform's
    // result, a custom check. Describe those as any value instead, and dates
    // and bigints as what they are on the wire.
    unrepresentable: 'any',
    override: (ctx: { zodSchema: any; jsonSchema: Record<string, unknown> }) => {
      const def = ctx.zodSchema._zod?.def
      if (def?.type !== 'date' && def?.type !== 'bigint') return
      // Only a coerced schema accepts what JSON sends; say so when one doesn't.
      if (options.io === 'input' && !def.coerce) warnUnsatisfiableInput(def.type, 'zod')
      Object.assign(
        ctx.jsonSchema,
        def.type === 'date'
          ? { type: 'string', format: 'date-time' }
          : // Only z.int64() is held to the 64-bit range.
            { type: 'integer', ...(def.format === 'int64' ? { format: 'int64' } : {}) },
      )
    },
  })
  return rest
}

/**
 * Wrap a Zod schema as a {@link KickSchema}.
 *
 * `TSchema` is inferred from the call site (any concrete Zod schema —
 * `z.object`, `z.string`, etc.) and run through {@link InferSchemaOutput}
 * to pull the parsed-output type via the Standard Schema phantom or the
 * legacy `_output` / `~output` brand. Without this inference,
 * `KickSchema<unknown>` would propagate into the `KickEnv` augmentation
 * and `kick typegen` would emit `interface KickEnv extends unknown {}`
 * — which TS rejects (TS2312, "interface can only extend object type").
 *
 * Adopters who want to spell the output type explicitly can either cast
 * the result (`fromZod(s) as KickSchema<MyShape>`) or pre-declare the
 * binding (`const s: KickSchema<MyShape> = fromZod(zodSchema)`). A
 * dedicated `<TOutput>(schema: unknown)` overload would always win
 * overload resolution and silently land at `unknown`, defeating the
 * inference this helper exists for.
 */
export function fromZod<TSchema>(schema: TSchema): KickSchema<InferSchemaOutput<TSchema>>
export function fromZod(schema: any): KickSchema<any> {
  return {
    safeParse(data: unknown): SchemaResult<any> {
      const result = schema.safeParse(data)
      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, issues: mapZodIssues(result.error) }
    },

    toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown> {
      return zodToJsonSchema(schema, options)
    },

    _raw: schema,
  }
}

export const zodAdapter = {
  name: 'zod' as const,
  detect: isZodSchema,
  wrap: fromZod,
}
