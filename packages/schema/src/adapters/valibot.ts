import * as v from 'valibot'
import type { KickSchema, SchemaResult, SchemaIssue, JsonSchemaOptions } from '../types.js'
import type { InferSchemaOutput } from '../infer.js'

export function isValibotSchema(schema: unknown): boolean {
  return (
    schema != null &&
    typeof schema === 'object' &&
    'kind' in (schema as any) &&
    'type' in (schema as any) &&
    'async' in (schema as any)
  )
}

function mapValibotIssues(issues: v.BaseIssue<unknown>[]): SchemaIssue[] {
  return issues.map((issue) => {
    const mapped: SchemaIssue = {
      path: (issue.path ?? []).map((seg: any) => String(seg?.key ?? seg)),
      message: issue.message ?? 'Validation failed',
      code: issue.type ?? 'unknown',
    }
    if (issue.expected !== undefined) mapped.expected = String(issue.expected)
    if (issue.received !== undefined) mapped.received = String(issue.received)
    return mapped
  })
}

let _toJsonSchemaFn: ((schema: any) => Record<string, unknown>) | null | undefined

import('@valibot/to-json-schema')
  .then((mod) => {
    _toJsonSchemaFn = mod.toJsonSchema as (schema: any) => Record<string, unknown>
  })
  .catch(() => {
    _toJsonSchemaFn = null
  })

function valibotToJsonSchema(schema: any, _options?: JsonSchemaOptions): Record<string, unknown> {
  if (_toJsonSchemaFn) {
    const { $schema: _, ...rest } = _toJsonSchemaFn(schema)
    return rest
  }
  return { type: 'object' }
}

/** Wrap a Valibot schema as a {@link KickSchema}. See `fromZod` for the
 * inference rationale — `TOutput` flows from the schema's Standard
 * Schema phantom so `kick typegen` can extend `KickEnv` from it. */
export function fromValibot<TSchema>(schema: TSchema): KickSchema<InferSchemaOutput<TSchema>>
export function fromValibot(schema: any): KickSchema<any> {
  return {
    safeParse(data: unknown): SchemaResult<any> {
      const result = v.safeParse(schema, data)
      if (result.success) {
        return { success: true, data: result.output }
      }
      return { success: false, issues: mapValibotIssues(result.issues) }
    },

    toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown> {
      return valibotToJsonSchema(schema, options)
    },

    _raw: schema,
  }
}

export const valibotAdapter = {
  name: 'valibot' as const,
  detect: isValibotSchema,
  wrap: fromValibot,
}
