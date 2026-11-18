/** One validation failure: where it is (`path`), what went wrong, and an error code. */
export interface SchemaIssue {
  path: string[]
  message: string
  code: string
  expected?: string
  received?: string
}

/** Result of {@link KickSchema.safeParse}: the parsed data, or the issues found. */
export type SchemaResult<T> = { success: true; data: T } | { success: false; issues: SchemaIssue[] }

/**
 * The library-neutral schema the framework validates with: `safeParse` plus `toJsonSchema` for OpenAPI.
 * Adapters wrap Zod, Valibot, Yup and Standard Schema validators into one.
 *
 * @see https://kickjs.app/guide/schema#the-kickschema-interface
 */
export interface KickSchema<TOutput = unknown, TInput = unknown> {
  safeParse(data: TInput): SchemaResult<TOutput>
  toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown>
  readonly _raw?: unknown
}

/** Options for {@link KickSchema.toJsonSchema}. */
export interface JsonSchemaOptions {
  readonly target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0'
  /**
   * Describe what the schema accepts (`'input'` — a request body, query or
   * params) or what it produces (`'output'`, the default — a response).
   * They differ for defaults, coercion and transforms.
   */
  readonly io?: 'input' | 'output'
}

/**
 * Teaches {@link detectSchema} a new schema library: `detect` recognises its schemas and `wrap`
 * turns one into a {@link KickSchema}. Register it with {@link registerAdapter}.
 *
 * @see https://kickjs.app/guide/schema#registering-a-custom-adapter
 */
export interface SchemaAdapter {
  readonly name: string
  detect(schema: unknown): boolean
  wrap(schema: unknown): KickSchema
}
