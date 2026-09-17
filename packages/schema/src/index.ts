export type {
  KickSchema,
  SchemaResult,
  SchemaIssue,
  JsonSchemaOptions,
  SchemaAdapter,
} from './types.js'

export type { InferSchemaOutput } from './infer.js'

export { detectSchema, isKickSchema, registerAdapter } from './detect.js'

export type { RouteTool, RouteToolRequest, RouteToolSource } from './route-tool.js'
export { buildRouteTool } from './route-tool.js'
