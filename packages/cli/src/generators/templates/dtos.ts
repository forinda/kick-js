import type { SchemaLib } from '../../config'
import type { TemplateContext } from './types'

/**
 * Body-schema source for one field, per library.
 *
 * The schemas are emitted RAW — no `fromZod` / `fromValibot` wrapper. Both
 * consumers already handle that: `detectSchema()` sniffs the library at
 * runtime, and `InferSchemaOutput<T>` reads Standard Schema / `_output` /
 * `__outputType` for typegen. Wrapping would only add an import.
 */
export const SCHEMA_SHAPES: Record<
  SchemaLib,
  {
    import: string
    /** Required field, 1-200 chars. */
    required: string
    /** Same field, optional — the update DTO. */
    optional: string
    infer: (schema: string) => string
    hint: string
  }
> = {
  zod: {
    import: `import { z } from 'zod'`,
    required: `z.string().min(1, 'Name is required').max(200)`,
    optional: `z.string().min(1).max(200).optional()`,
    infer: (schema) => `z.infer<typeof ${schema}>`,
    hint: [
      ' *   z.string(), z.number(), z.boolean(), z.enum([...]),',
      ' *   z.array(), z.object(), .optional(), .default(), .transform()',
    ].join('\n'),
  },
  valibot: {
    import: `import * as v from 'valibot'`,
    required: `v.pipe(v.string(), v.minLength(1, 'Name is required'), v.maxLength(200))`,
    optional: `v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200)))`,
    infer: (schema) => `v.InferOutput<typeof ${schema}>`,
    hint: [
      ' *   v.string(), v.number(), v.boolean(), v.picklist([...]),',
      ' *   v.array(), v.object(), v.optional(), and v.pipe(...) to chain checks',
    ].join('\n'),
  },
  yup: {
    import: `import * as yup from 'yup'`,
    required: `yup.string().required('Name is required').min(1).max(200)`,
    optional: `yup.string().min(1).max(200).optional()`,
    infer: (schema) => `yup.InferType<typeof ${schema}>`,
    hint: [
      ' *   yup.string(), yup.number(), yup.boolean(), .oneOf([...]),',
      ' *   yup.array(), yup.object(), .required(), .optional(), .default()',
    ].join('\n'),
  },
}

/** Object-schema wrapper differs only in the callee. */
export function objectSchema(lib: SchemaLib, body: string): string {
  const callee = lib === 'zod' ? 'z.object' : lib === 'valibot' ? 'v.object' : 'yup.object'
  return `${callee}({\n  ${body},\n})`
}

export function generateCreateDTO(ctx: TemplateContext): string {
  const { pascal } = ctx
  const lib = ctx.schemaLib ?? 'zod'
  const shape = SCHEMA_SHAPES[lib]
  const name = `create${pascal}Schema`
  const libName = lib === 'zod' ? 'Zod' : lib === 'valibot' ? 'Valibot' : 'Yup'
  return `${shape.import}

/**
 * Create ${pascal} DTO — ${libName} schema for validating POST request bodies.
 * This schema is passed to @Post('/', { body: ${name} }) for automatic validation.
 * It also generates OpenAPI request body docs when SwaggerAdapter is used.
 *
 * Add more fields as needed. Supported ${libName} types:
${shape.hint}
 */
export const ${name} = ${objectSchema(lib, `name: ${shape.required}`)}

export type Create${pascal}DTO = ${shape.infer(name)}
`
}

export function generateUpdateDTO(ctx: TemplateContext): string {
  const { pascal } = ctx
  const lib = ctx.schemaLib ?? 'zod'
  const shape = SCHEMA_SHAPES[lib]
  const name = `update${pascal}Schema`
  return `${shape.import}

export const ${name} = ${objectSchema(lib, `name: ${shape.optional}`)}

export type Update${pascal}DTO = ${shape.infer(name)}
`
}

export function generateResponseDTO(ctx: TemplateContext): string {
  const { pascal } = ctx
  return `export interface ${pascal}ResponseDTO {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
`
}
