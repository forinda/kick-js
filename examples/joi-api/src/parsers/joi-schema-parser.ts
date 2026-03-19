/**
 * Custom SchemaParser for Joi.
 *
 * Demonstrates how to integrate a non-Zod validation library with KickJS Swagger.
 * Implement the SchemaParser interface and pass it to SwaggerAdapter.
 *
 * Requirements:
 *   - `joi` — the validation library
 *   - `joi-to-json` — converts Joi schemas to JSON Schema
 */
import Joi from 'joi'
import joiToJson from 'joi-to-json'
import type { SchemaParser } from '@kickjs/swagger'

export const joiSchemaParser: SchemaParser = {
  name: 'joi',

  /**
   * Check if the given schema is a Joi schema.
   * Joi schemas have a `describe()` method and a `$_root` property.
   */
  supports(schema: unknown): boolean {
    return Joi.isSchema(schema)
  },

  /**
   * Convert a Joi schema to JSON Schema using joi-to-json.
   * Remove the $schema key — the OpenAPI builder manages the top-level.
   */
  toJsonSchema(schema: unknown): Record<string, unknown> {
    const result = joiToJson(schema as Joi.Schema)
    delete result.$schema
    return result
  },
}
