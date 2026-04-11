/**
 * Minimal Zod v4+ schema parser.
 *
 * Mirrors the `zodSchemaParser` in `@forinda/kickjs-swagger`. Zod v4
 * ships with a native `.toJSONSchema()` instance method, so this is
 * just a type guard + a call.
 *
 * Kept in-package (rather than importing from Swagger) so the MCP
 * adapter has no dependency on the Swagger package. If KickJS ever
 * extracts a shared `@forinda/kickjs-schema` utility, both adapters
 * can switch to it in one PR.
 */

/**
 * Check whether a value looks like a Zod v4+ schema.
 *
 * Uses structural duck-typing: the object has `safeParse` (all Zod
 * versions) AND `toJSONSchema` (Zod v4+). This avoids importing Zod
 * as a value, which would force it to become a runtime dep.
 */
export function isZodSchema(schema: unknown): boolean {
  return (
    schema != null &&
    typeof schema === 'object' &&
    typeof (schema as { safeParse?: unknown }).safeParse === 'function' &&
    typeof (schema as { toJSONSchema?: unknown }).toJSONSchema === 'function'
  )
}

/**
 * Convert a Zod v4+ schema to a JSON Schema object, stripping the
 * top-level `$schema` key so the output can be embedded inside an
 * MCP tool definition directly.
 *
 * Returns `null` if the input doesn't look like a Zod schema. Callers
 * should fall back to an empty-object input schema in that case.
 */
export function zodToJsonSchema(schema: unknown): Record<string, unknown> | null {
  if (!isZodSchema(schema)) return null
  const { $schema: _ignored, ...rest } = (
    schema as { toJSONSchema: () => Record<string, unknown> }
  ).toJSONSchema() as Record<string, unknown>
  return rest
}
