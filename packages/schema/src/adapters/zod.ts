import type { KickSchema, SchemaResult, SchemaIssue, JsonSchemaOptions } from '../types.js'

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

export function fromZod<TOutput = unknown>(schema: any): KickSchema<TOutput> {
  return {
    safeParse(data: unknown): SchemaResult<TOutput> {
      const result = schema.safeParse(data)
      if (result.success) {
        return { success: true, data: result.data as TOutput }
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
