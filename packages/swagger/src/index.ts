// Schema Parser (pluggable validation → JSON Schema conversion)
export { zodSchemaParser, type SchemaParser } from './schema-parser'

// Decorators
export {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiSecurity,
  ApiPublic,
  ApiExclude,
  type ApiOperationOptions,
  type ApiResponseOptions,
  type ApiSecurityRequirement,
} from './decorators'

// Spec Builder
export {
  buildOpenAPISpec,
  registerControllerForDocs,
  clearRegisteredRoutes,
  type OpenAPIInfo,
  type OpenAPISecurityScheme,
  type SecurityResolverContext,
  type SwaggerOptions,
} from './openapi-builder'

// Adapter
export { SwaggerAdapter, type SwaggerAdapterOptions, type UIRenderer } from './swagger.adapter'

// UI Generators
export { swaggerUIHtml, redocHtml } from './ui'
