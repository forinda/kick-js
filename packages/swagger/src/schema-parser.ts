import { detectSchema, isKickSchema } from '@forinda/kickjs-schema'

/**
 * Interface for converting validation library schemas to JSON Schema.
 *
 * @deprecated Use `@forinda/kickjs-schema` adapters instead. Schemas that
 * implement KickSchema or StandardSchemaV1 are auto-detected and converted
 * via `detectSchema().toJsonSchema()`. This interface is preserved for
 * backwards compatibility with custom parsers passed to SwaggerAdapter.
 *
 * @example
 * ```ts
 * import Joi from 'joi'
 * import joiToJson from 'joi-to-json'
 *
 * const joiParser: SchemaParser = {
 *   name: 'joi',
 *   supports: (schema) => Joi.isSchema(schema),
 *   toJsonSchema: (schema) => joiToJson(schema),
 * }
 *
 * SwaggerAdapter({ schemaParser: joiParser })
 * ```
 */
export interface SchemaParser {
  /** Human-readable name for logging/debugging */
  readonly name: string

  /**
   * Return true if this parser can handle the given schema object.
   * Called before `toJsonSchema` to allow graceful fallback.
   */
  supports(schema: unknown): boolean

  /**
   * Convert a validation schema to a JSON Schema object.
   * Should return a plain object conforming to JSON Schema draft-07 or later.
   * Must not include the top-level `$schema` key — the builder adds it.
   */
  toJsonSchema(schema: unknown): Record<string, unknown>
}

/**
 * Default schema parser using @forinda/kickjs-schema auto-detection.
 * Supports Zod, Standard Schema v1, and any KickSchema adapter.
 */
export const zodSchemaParser: SchemaParser = {
  name: 'kickjs-schema',

  supports(schema: unknown): boolean {
    if (schema == null) return false
    if (isKickSchema(schema)) return true
    if (typeof schema === 'object' && '~standard' in (schema as object)) return true
    if (
      typeof schema === 'object' &&
      typeof (schema as any).safeParse === 'function' &&
      typeof (schema as any).toJSONSchema === 'function'
    )
      return true
    if (typeof schema === 'object' && typeof (schema as any).safeParse === 'function') return true
    return false
  },

  toJsonSchema(schema: unknown): Record<string, unknown> {
    const wrapped = detectSchema(schema)
    return wrapped.toJsonSchema({ target: 'openapi-3.0' })
  },
}
