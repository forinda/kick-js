export interface SchemaIssue {
  path: string[]
  message: string
  code: string
  expected?: string
  received?: string
}

export type SchemaResult<T> = { success: true; data: T } | { success: false; issues: SchemaIssue[] }

export interface KickSchema<TOutput = unknown, TInput = unknown> {
  safeParse(data: TInput): SchemaResult<TOutput>
  toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown>
  readonly _raw?: unknown
}

export interface JsonSchemaOptions {
  readonly target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0'
  /**
   * Describe what the schema accepts (`'input'` — a request body, query or
   * params) or what it produces (`'output'`, the default — a response).
   * They differ for defaults, coercion and transforms.
   */
  readonly io?: 'input' | 'output'
}

export interface SchemaAdapter {
  readonly name: string
  detect(schema: unknown): boolean
  wrap(schema: unknown): KickSchema
}
