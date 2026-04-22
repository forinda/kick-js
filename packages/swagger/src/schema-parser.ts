/**
 * Interface for converting validation library schemas to JSON Schema.
 *
 * KickJS ships with a Zod parser by default. To use a different validation
 * library (Yup, Joi, Valibot, ArkType, etc.), implement this interface and
 * pass it to the SwaggerAdapter.
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
 * Default schema parser for Zod v4+.
 * Uses Zod's built-in `.toJSONSchema()` instance method.
 */
export const zodSchemaParser: SchemaParser = {
  name: 'zod',

  supports(schema: unknown): boolean {
    return (
      schema != null &&
      typeof schema === 'object' &&
      typeof (schema as any).safeParse === 'function' &&
      typeof (schema as any).toJSONSchema === 'function'
    )
  },

  toJsonSchema(schema: unknown): Record<string, unknown> {
    const { $schema: _, ...rest } = (schema as any).toJSONSchema() as Record<string, unknown>
    return rest
  },
}
