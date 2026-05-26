import * as v from 'valibot'
import type { KickSchema, SchemaResult, SchemaIssue, JsonSchemaOptions } from '../types.js'

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

let _toJsonSchemaPromise: Promise<((schema: any) => Record<string, unknown>) | null> | undefined
let _toJsonSchemaResolved: ((schema: any) => Record<string, unknown>) | null | undefined

function initToJsonSchema(): void {
  if (_toJsonSchemaPromise) return
  _toJsonSchemaPromise = import('@valibot/to-json-schema')
    .then((mod) => {
      _toJsonSchemaResolved = mod.toJsonSchema ?? null
      return _toJsonSchemaResolved
    })
    .catch(() => {
      _toJsonSchemaResolved = null
      return null
    })
}

initToJsonSchema()

function valibotToJsonSchema(schema: any, _options?: JsonSchemaOptions): Record<string, unknown> {
  if (_toJsonSchemaResolved) {
    const { $schema: _, ...rest } = _toJsonSchemaResolved(schema) as Record<string, unknown>
    return rest
  }
  return { type: 'object' }
}

export function fromValibot<TOutput = unknown>(schema: any): KickSchema<TOutput> {
  return {
    safeParse(data: unknown): SchemaResult<TOutput> {
      const result = v.safeParse(schema, data)
      if (result.success) {
        return { success: true, data: result.output as TOutput }
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
