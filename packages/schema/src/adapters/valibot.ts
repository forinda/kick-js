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

let _toJsonSchema: ((schema: any) => Record<string, unknown>) | null | undefined

function getToJsonSchema(): ((schema: any) => Record<string, unknown>) | null {
  if (_toJsonSchema !== undefined) return _toJsonSchema
  try {
    _toJsonSchema = require('@valibot/to-json-schema').toJsonSchema
  } catch {
    _toJsonSchema = null
  }
  return _toJsonSchema
}

function valibotToJsonSchema(schema: any, _options?: JsonSchemaOptions): Record<string, unknown> {
  const convert = getToJsonSchema()
  if (convert) {
    const { $schema: _, ...rest } = convert(schema) as Record<string, unknown>
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
