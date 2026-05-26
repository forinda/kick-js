export type {
  KickSchema,
  SchemaResult,
  SchemaIssue,
  JsonSchemaOptions,
  SchemaAdapter,
} from './types.js'

export type { InferSchemaOutput } from './infer.js'

export { detectSchema, isKickSchema, registerAdapter } from './detect.js'
