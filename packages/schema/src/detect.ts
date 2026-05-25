import type { KickSchema, SchemaAdapter } from './types.js'
import { isZodSchema, fromZod } from './adapters/zod.js'

const customAdapters: SchemaAdapter[] = []

export function registerAdapter(adapter: SchemaAdapter): void {
  customAdapters.push(adapter)
}

export function isKickSchema(schema: unknown): schema is KickSchema {
  return (
    schema != null &&
    typeof schema === 'object' &&
    typeof (schema as any).safeParse === 'function' &&
    typeof (schema as any).toJsonSchema === 'function'
  )
}

function hasStandardSchema(schema: unknown): boolean {
  return schema != null && typeof schema === 'object' && '~standard' in (schema as any)
}

function fromStandardSchema(schema: any): KickSchema {
  const std = schema['~standard']
  return {
    safeParse(data: unknown) {
      const result = std.validate(data)
      if ('value' in result && result.issues === undefined) {
        return { success: true, data: result.value }
      }
      if (result instanceof Promise) {
        throw new Error(
          'Async Standard Schema validation is not supported in synchronous context. ' +
            'Use an adapter that supports sync validation.',
        )
      }
      const issues = (result.issues ?? []).map((issue: any) => ({
        path: (issue.path ?? []).map((seg: any) => String(seg?.key ?? seg)),
        message: issue.message ?? 'Validation failed',
        code: 'validation',
      }))
      return { success: false, issues }
    },

    toJsonSchema() {
      if (std.jsonSchema && typeof std.jsonSchema.input === 'function') {
        return std.jsonSchema.input()
      }
      if (typeof schema.toJSONSchema === 'function') {
        const { $schema: _, ...rest } = schema.toJSONSchema()
        return rest
      }
      return { type: 'object' }
    },

    _raw: schema,
  }
}

export function detectSchema(schema: unknown): KickSchema {
  if (isKickSchema(schema)) return schema

  for (const adapter of customAdapters) {
    if (adapter.detect(schema)) return adapter.wrap(schema)
  }

  if (hasStandardSchema(schema)) return fromStandardSchema(schema)

  if (isZodSchema(schema)) return fromZod(schema)

  if (typeof schema === 'function') {
    return {
      safeParse(data: unknown) {
        try {
          const result = (schema as Function)(data)
          return { success: true, data: result }
        } catch (err: any) {
          return {
            success: false,
            issues: [{ path: [], message: err.message ?? 'Validation failed', code: 'custom' }],
          }
        }
      },
      toJsonSchema() {
        return { type: 'object' }
      },
    }
  }

  throw new Error(
    'Unrecognized schema. Wrap it with fromZod(), fromValibot(), etc., ' +
      'or implement the StandardSchemaV1 interface.',
  )
}
