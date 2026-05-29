import type { KickSchema, SchemaResult, SchemaIssue, JsonSchemaOptions } from '../types.js'
import type { InferSchemaOutput } from '../infer.js'

export function isYupSchema(schema: unknown): boolean {
  return (
    schema != null &&
    typeof schema === 'object' &&
    typeof (schema as any).validateSync === 'function' &&
    typeof (schema as any).describe === 'function' &&
    typeof (schema as any).isValidSync === 'function'
  )
}

function mapYupErrors(err: any): SchemaIssue[] {
  const inner: any[] = err.inner ?? []
  if (inner.length === 0) {
    return [
      {
        path: err.path ? err.path.split('.') : [],
        message: err.message ?? 'Validation failed',
        code: err.type ?? 'unknown',
      },
    ]
  }
  return inner.map((e: any) => {
    const mapped: SchemaIssue = {
      path: e.path ? e.path.split('.') : [],
      message: e.message ?? 'Validation failed',
      code: e.type ?? 'unknown',
    }
    if (e.params?.min !== undefined) mapped.expected = `>=${e.params.min}`
    if (e.params?.max !== undefined) mapped.expected = `<=${e.params.max}`
    if (e.params?.regex !== undefined) mapped.expected = String(e.params.regex)
    return mapped
  })
}

function yupToJsonSchema(schema: any, _options?: JsonSchemaOptions): Record<string, unknown> {
  const desc = schema.describe()
  return descToJsonSchema(desc)
}

function descToJsonSchema(desc: any): Record<string, unknown> {
  if (desc.type === 'object') {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, field] of Object.entries(desc.fields ?? {})) {
      properties[key] = descToJsonSchema(field as any)
      if (!(field as any).optional && !(field as any).nullable) {
        required.push(key)
      }
    }
    const schema: Record<string, unknown> = { type: 'object', properties }
    if (required.length > 0) schema.required = required
    return schema
  }

  if (desc.type === 'array') {
    const schema: Record<string, unknown> = { type: 'array' }
    if (desc.innerType) schema.items = descToJsonSchema(desc.innerType)
    return schema
  }

  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'string',
  }

  const schema: Record<string, unknown> = { type: typeMap[desc.type] ?? desc.type }

  for (const test of desc.tests ?? []) {
    if (test.name === 'email') schema.format = 'email'
    if (test.name === 'url') schema.format = 'uri'
    if (test.name === 'min' && test.params?.min !== undefined) {
      if (desc.type === 'number') schema.minimum = test.params.min
      else schema.minLength = test.params.min
    }
    if (test.name === 'max' && test.params?.max !== undefined) {
      if (desc.type === 'number') schema.maximum = test.params.max
      else schema.maxLength = test.params.max
    }
  }

  if (desc.oneOf && desc.oneOf.length > 0) schema.enum = desc.oneOf

  return schema
}

/** Wrap a Yup schema as a {@link KickSchema}. `InferSchemaOutput` reads
 * the schema's output brand — Yup exposes it as `__outputType`. When the
 * brand isn't statically discoverable, the result lands at `unknown` and
 * adopters cast (`fromYup(schema) as KickSchema<MyShape>`). */
export function fromYup<TSchema>(schema: TSchema): KickSchema<InferSchemaOutput<TSchema>>
export function fromYup(schema: any): KickSchema<any> {
  return {
    safeParse(data: unknown): SchemaResult<any> {
      try {
        const result = schema.validateSync(data, { abortEarly: false, stripUnknown: false })
        return { success: true, data: result }
      } catch (err: any) {
        if (err.name === 'ValidationError') {
          return { success: false, issues: mapYupErrors(err) }
        }
        throw err
      }
    },

    toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown> {
      return yupToJsonSchema(schema, options)
    },

    _raw: schema,
  }
}

export const yupAdapter = {
  name: 'yup' as const,
  detect: isYupSchema,
  wrap: fromYup,
}
