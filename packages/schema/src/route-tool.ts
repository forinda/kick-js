import { detectSchema } from './detect.js'

/** A route to expose as a tool (MCP, LLM function calling). */
export interface RouteToolSource {
  /** HTTP method, any case. */
  method: string
  /** Full route path with `:param` placeholders, e.g. `/api/v1/tasks/:id`. */
  path: string
  /** Route validation schemas, from any library `detectSchema` understands. */
  params?: unknown
  query?: unknown
  body?: unknown
  /**
   * Replaces the query/body part of the input schema (e.g. `@McpTool({ inputSchema })`).
   * Path parameters are still added. Its fields go to the body on
   * POST/PUT/PATCH and to the query string otherwise.
   */
  input?: unknown
}

/** A request built from tool arguments. */
export interface RouteToolRequest {
  /** Path with parameters filled in and the query string appended. */
  url: string
  /** JSON body, for POST/PUT/PATCH. */
  body?: unknown
}

export interface RouteTool {
  /**
   * One JSON Schema object for the tool's arguments: path parameters (always
   * required), query fields and body fields side by side. A body that is not
   * an object (an array, say) appears as a single `body` property.
   */
  inputSchema: Record<string, unknown>
  /**
   * Split tool arguments back into a request. Throws when a path parameter
   * is missing, so a call never reaches a literal `/:id` URL.
   */
  toRequest(args: Record<string, unknown> | undefined): RouteToolRequest
}

type JsonSchema = Record<string, unknown>

const PARAM_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)/g
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

function toJson(schema: unknown): JsonSchema | undefined {
  if (schema == null) return undefined
  const { $schema: _, ...rest } = detectSchema(schema).toJsonSchema()
  return rest
}

function propertiesOf(json: JsonSchema | undefined): Record<string, JsonSchema> {
  return (json?.properties as Record<string, JsonSchema> | undefined) ?? {}
}

function requiredOf(json: JsonSchema | undefined): string[] {
  return Array.isArray(json?.required) ? (json.required as string[]) : []
}

/** An object schema whose fields can be merged into the tool input. */
function isObjectSchema(json: JsonSchema | undefined): boolean {
  return json !== undefined && (json.type === 'object' || json.properties !== undefined)
}

/**
 * Build a tool's input schema from a route, and the mapping from tool
 * arguments back to a request. Shared by `@forinda/kickjs-mcp` and
 * `@forinda/kickjs-ai` so both expose routes the same way.
 *
 * @example
 * ```ts
 * const tool = buildRouteTool({
 *   method: 'PUT',
 *   path: '/api/v1/tasks/:id',
 *   body: z.object({ title: z.string() }),
 * })
 * tool.inputSchema // { type: 'object', properties: { id: {...}, title: {...} }, required: ['id', 'title'] }
 * tool.toRequest({ id: '42', title: 'Ship' }) // { url: '/api/v1/tasks/42', body: { title: 'Ship' } }
 * ```
 */
export function buildRouteTool(source: RouteToolSource): RouteTool {
  const method = source.method.toUpperCase()
  const hasBody = BODY_METHODS.has(method)
  const pathParams = [...source.path.matchAll(PARAM_PATTERN)].map((match) => match[1])

  const paramsJson = toJson(source.params)
  const queryJson = toJson(source.input !== undefined && !hasBody ? source.input : source.query)
  const bodyJson = hasBody ? toJson(source.input ?? source.body) : undefined
  const bodyIsObject = bodyJson === undefined || isObjectSchema(bodyJson)

  const properties: Record<string, JsonSchema> = {}
  const required = new Set<string>()

  const queryKeys = new Set(Object.keys(propertiesOf(queryJson)))
  const bodyKeys = new Set(bodyIsObject ? Object.keys(propertiesOf(bodyJson)) : [])

  // Later sources don't overwrite earlier ones: path params, then body, then query.
  for (const name of pathParams) {
    properties[name] = propertiesOf(paramsJson)[name] ?? { type: 'string' }
    required.add(name)
  }
  if (bodyJson && bodyIsObject) {
    for (const [name, schema] of Object.entries(propertiesOf(bodyJson))) properties[name] ??= schema
    for (const name of requiredOf(bodyJson)) required.add(name)
  } else if (bodyJson) {
    properties.body = bodyJson
    required.add('body')
  }
  for (const [name, schema] of Object.entries(propertiesOf(queryJson))) properties[name] ??= schema
  for (const name of requiredOf(queryJson)) required.add(name)

  const inputSchema: JsonSchema = { type: 'object', properties }
  if (required.size > 0) inputSchema.required = [...required]

  const toRequest = (rawArgs: Record<string, unknown> | undefined): RouteToolRequest => {
    const args = rawArgs ?? {}

    const path = source.path.replace(PARAM_PATTERN, (_match, name: string) => {
      const value = args[name]
      if (value === undefined || value === null || value === '') {
        throw new Error(`Missing path parameter "${name}" for ${method} ${source.path}`)
      }
      return encodeURIComponent(String(value))
    })

    const query = new URLSearchParams()
    const body: Record<string, unknown> = {}
    const pathParamNames = new Set(pathParams)

    for (const [name, value] of Object.entries(args)) {
      if (value === undefined) continue
      if (!bodyIsObject && name === 'body') continue
      const inBody = hasBody && bodyIsObject && (bodyKeys.has(name) || !queryKeys.has(name))
      if (pathParamNames.has(name) && !bodyKeys.has(name) && !queryKeys.has(name)) continue
      if (inBody) {
        body[name] = value
      } else if (value !== null) {
        for (const item of Array.isArray(value) ? value : [value]) {
          query.append(name, typeof item === 'string' ? item : JSON.stringify(item))
        }
      }
    }

    const search = query.toString()
    return {
      url: search ? `${path}?${search}` : path,
      ...(hasBody ? { body: bodyIsObject ? body : args.body } : {}),
    }
  }

  return { inputSchema, toRequest }
}
