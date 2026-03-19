import 'reflect-metadata'
import { METADATA, type RouteDefinition } from '@kickjs/core'
import { SWAGGER_KEYS, type ApiOperationOptions, type ApiResponseOptions } from './decorators'
import { zodSchemaParser, type SchemaParser } from './schema-parser'

export interface OpenAPIInfo {
  title: string
  version: string
  description?: string
}

export interface SwaggerOptions {
  info?: Partial<OpenAPIInfo>
  servers?: { url: string; description?: string }[]
  bearerAuth?: boolean
  /**
   * Pluggable schema parser for converting validation schemas to JSON Schema.
   * Defaults to `zodSchemaParser` which handles Zod v4+ schemas.
   *
   * Override this to use Yup, Joi, Valibot, ArkType, or any other library.
   *
   * @example
   * ```ts
   * new SwaggerAdapter({
   *   schemaParser: myYupParser,
   * })
   * ```
   */
  schemaParser?: SchemaParser
}

interface RegisteredRoute {
  controllerClass: any
  mountPath: string
}

const registeredRoutes: RegisteredRoute[] = []

/** Register a controller for OpenAPI introspection (called by Application during route mounting) */
export function registerControllerForDocs(controllerClass: any, mountPath: string): void {
  registeredRoutes.push({ controllerClass, mountPath })
}

/** Clear all registered routes (for HMR) */
export function clearRegisteredRoutes(): void {
  registeredRoutes.length = 0
}

/** Build a full OpenAPI 3.0.3 spec from registered controllers and their decorators */
export function buildOpenAPISpec(options: SwaggerOptions = {}): any {
  const parser = options.schemaParser ?? zodSchemaParser

  /** Convert a validation schema to JSON Schema using the configured parser */
  const toJsonSchema = (schema: unknown): Record<string, unknown> | null => {
    try {
      if (!parser.supports(schema)) return null
      return parser.toJsonSchema(schema)
    } catch {
      return null
    }
  }

  const componentSchemas: Record<string, any> = {}
  let schemaCounter = 0

  /**
   * Register a schema in components.schemas and return a $ref pointer.
   * If the schema has a title/label, use that as the name. Otherwise generate one.
   */
  const registerSchema = (jsonSchema: Record<string, unknown>, hint?: string): any => {
    // Try to extract a name from the schema
    let name = (jsonSchema.title as string) || (jsonSchema.label as string) || hint || ''
    if (!name) {
      name = `Schema${++schemaCounter}`
    }
    // Sanitize name for OpenAPI (remove spaces, special chars)
    name = name.replace(/[^a-zA-Z0-9]/g, '')

    // Avoid duplicates — if already registered with same name, reuse
    if (!componentSchemas[name]) {
      const clean = { ...jsonSchema }
      delete clean.title
      delete clean.label
      delete clean.$schema
      componentSchemas[name] = clean
    }
    return { $ref: `#/components/schemas/${name}` }
  }

  const spec: any = {
    openapi: '3.0.3',
    info: {
      title: options.info?.title || 'API',
      version: options.info?.version || '1.0.0',
      ...(options.info?.description ? { description: options.info.description } : {}),
    },
    paths: {},
    components: { schemas: {}, securitySchemes: {} },
    tags: [],
  }

  if (options.servers) {
    spec.servers = options.servers
  }

  const allTags = new Set<string>()
  const securitySchemes: Record<string, any> = {}

  for (const { controllerClass, mountPath } of registeredRoutes) {
    // Skip excluded controllers
    if (Reflect.getMetadata(SWAGGER_KEYS.EXCLUDE, controllerClass)) continue

    const routes: RouteDefinition[] =
      Reflect.getMetadata(METADATA.ROUTES, controllerClass) || []
    const classTags: string[] =
      Reflect.getMetadata(SWAGGER_KEYS.TAGS, controllerClass) || []
    const classAuth: string | undefined =
      Reflect.getMetadata(SWAGGER_KEYS.BEARER_AUTH, controllerClass)
    const controllerPath =
      Reflect.getMetadata(METADATA.CONTROLLER_PATH, controllerClass) || '/'

    for (const route of routes) {
      // Skip excluded methods
      if (Reflect.getMetadata(SWAGGER_KEYS.EXCLUDE, controllerClass, route.handlerName)) continue

      // Build the full path
      let routePath = route.path === '/' ? '' : route.path
      let fullPath = mountPath + (controllerPath === '/' ? '' : controllerPath) + routePath
      if (!fullPath) fullPath = '/'

      // Convert Express :param to OpenAPI {param}
      const openApiPath = fullPath.replace(/:([a-zA-Z_]+)/g, '{$1}')
      const method = route.method.toLowerCase()

      // Gather metadata
      const operation: ApiOperationOptions =
        Reflect.getMetadata(SWAGGER_KEYS.OPERATION, controllerClass, route.handlerName) || {}
      const responses: ApiResponseOptions[] =
        Reflect.getMetadata(SWAGGER_KEYS.RESPONSES, controllerClass, route.handlerName) || []
      const methodTags: string[] =
        Reflect.getMetadata(SWAGGER_KEYS.TAGS, controllerClass, route.handlerName) || []
      const methodAuth: string | undefined =
        Reflect.getMetadata(SWAGGER_KEYS.BEARER_AUTH, controllerClass, route.handlerName)

      // Tags — method level overrides class level
      const tags = methodTags.length > 0 ? methodTags : classTags
      tags.forEach((t) => allTags.add(t))

      // Build operation object
      const op: any = {
        ...(tags.length > 0 ? { tags } : {}),
        ...(operation.summary ? { summary: operation.summary } : {}),
        ...(operation.description ? { description: operation.description } : {}),
        ...(operation.operationId ? { operationId: operation.operationId } : {}),
        ...(operation.deprecated ? { deprecated: true } : {}),
        parameters: [],
        responses: {},
      }

      // Path parameters
      const paramMatches = fullPath.match(/:([a-zA-Z_]+)/g) || []
      for (const match of paramMatches) {
        const paramName = match.slice(1)
        let schema: any = { type: 'string' }

        // Try to get type from params validation schema
        if (route.validation?.params) {
          const jsonSchema = toJsonSchema(route.validation.params)
          if (jsonSchema?.properties && typeof jsonSchema.properties === 'object') {
            const props = jsonSchema.properties as Record<string, any>
            if (props[paramName]) {
              schema = props[paramName]
            }
          }
        }

        op.parameters.push({
          name: paramName,
          in: 'path',
          required: true,
          schema,
        })
      }

      // Query parameters
      if (route.validation?.query) {
        const jsonSchema = toJsonSchema(route.validation.query)
        if (jsonSchema?.properties && typeof jsonSchema.properties === 'object') {
          const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : []
          for (const [name, propSchema] of Object.entries(
            jsonSchema.properties as Record<string, any>,
          )) {
            op.parameters.push({
              name,
              in: 'query',
              required: required.includes(name),
              schema: propSchema,
            })
          }
        }
      }

      // Remove empty parameters array
      if (op.parameters.length === 0) delete op.parameters

      // Request body
      if (route.validation?.body && ['post', 'put', 'patch'].includes(method)) {
        const bodySchema = toJsonSchema(route.validation.body)
        if (bodySchema) {
          const ref = registerSchema(bodySchema, `${route.handlerName}Body`)
          op.requestBody = {
            required: true,
            content: { 'application/json': { schema: ref } },
          }
        }
      }

      // File upload detection
      const fileUpload = Reflect.getMetadata(METADATA.FILE_UPLOAD, controllerClass, route.handlerName)
      if (fileUpload) {
        const properties: any = {}
        if (fileUpload.fieldName) {
          properties[fileUpload.fieldName] = {
            type: 'string',
            format: 'binary',
          }
        }
        op.requestBody = {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties },
            },
          },
        }
      }

      // Responses
      if (responses.length > 0) {
        for (const resp of responses) {
          op.responses[String(resp.status)] = {
            description: resp.description || '',
            ...(resp.schema
              ? (() => {
                  const converted = typeof resp.schema === 'function' || typeof resp.schema === 'object'
                    ? toJsonSchema(resp.schema)
                    : null
                  const finalSchema = converted
                    ? registerSchema(converted, `${route.handlerName}Response${resp.status}`)
                    : (typeof resp.schema === 'object' ? resp.schema : undefined)
                  return finalSchema
                    ? { content: { 'application/json': { schema: finalSchema } } }
                    : {}
                })()
              : {}),
          }
        }
      } else {
        // Auto-generate default responses
        const defaultStatus = method === 'post' ? '201' : method === 'delete' ? '204' : '200'
        op.responses[defaultStatus] = { description: 'Successful operation' }

        if (route.validation?.body) {
          op.responses['422'] = { description: 'Validation error' }
        }
      }

      // Security
      const authName = methodAuth || classAuth
      if (authName) {
        op.security = [{ [authName]: [] }]
        securitySchemes[authName] = {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        }
      }

      // Mount
      if (!spec.paths[openApiPath]) spec.paths[openApiPath] = {}
      spec.paths[openApiPath][method] = op
    }
  }

  // Finalize
  spec.tags = Array.from(allTags).map((name) => ({ name }))
  spec.components.securitySchemes = securitySchemes

  if (options.bearerAuth) {
    if (!securitySchemes.BearerAuth) {
      spec.components.securitySchemes.BearerAuth = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      }
    }
    spec.security = [{ BearerAuth: [] }]
  }

  // Merge collected schemas into components
  spec.components.schemas = componentSchemas

  // Clean up empty components
  if (Object.keys(spec.components.schemas).length === 0) delete spec.components.schemas
  if (Object.keys(spec.components.securitySchemes).length === 0) delete spec.components.securitySchemes
  if (Object.keys(spec.components).length === 0) delete spec.components

  return spec
}

