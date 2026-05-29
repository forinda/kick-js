import type { KickSchema, SchemaResult, SchemaIssue, JsonSchemaOptions } from '../types.js'
import type { InferSchemaOutput } from '../infer.js'

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

function zodToJsonSchema(schema: any, _options?: JsonSchemaOptions): Record<string, unknown> {
  if (typeof schema.toJSONSchema === 'function') {
    const { $schema: _, ...rest } = schema.toJSONSchema()
    return rest
  }
  return { type: 'object' }
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
