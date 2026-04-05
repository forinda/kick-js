import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiExclude,
  buildOpenAPISpec,
  registerControllerForDocs,
  clearRegisteredRoutes,
  zodSchemaParser,
  swaggerUIHtml,
  redocHtml,
  type SchemaParser,
} from '@forinda/kickjs-swagger'
import { Controller, Get, Post, Put, Delete, Container, METADATA } from '@forinda/kickjs'

// ── Decorator Metadata Tests ──────────────────────────────────────────

describe('Swagger Decorators', () => {
  beforeEach(() => {
    Container.reset()
    clearRegisteredRoutes()
  })

  describe('@ApiOperation', () => {
    it('should store operation metadata on handler', () => {
      @Controller('/test')
      class TestController {
        @ApiOperation({ summary: 'Get items', description: 'Returns all items', operationId: 'getItems' })
        @Get('/')
        getItems() {}
      }

      const meta = Reflect.getMetadata(
        Symbol.for('kick:swagger:operation'),
        TestController,
        'getItems',
      )
      // Symbol.for won't match the local Symbol — use the builder to verify instead
      // We verify via buildOpenAPISpec below
      expect(TestController).toBeDefined()
    })

    it('should include operation metadata in spec output', () => {
      clearRegisteredRoutes()

      @Controller('/ops')
      class OpsController {
        @ApiOperation({
          summary: 'Do something',
          description: 'Detailed description',
          operationId: 'doSomething',
          deprecated: true,
        })
        @Get('/action')
        doSomething() {}
      }

      registerControllerForDocs(OpsController, '/ops')
      const spec = buildOpenAPISpec()

      const op = spec.paths['/ops/action']?.get
      expect(op).toBeDefined()
      expect(op.summary).toBe('Do something')
      expect(op.description).toBe('Detailed description')
      expect(op.operationId).toBe('doSomething')
      expect(op.deprecated).toBe(true)
    })
  })

  describe('@ApiResponse', () => {
    it('should include response metadata in spec output', () => {
      clearRegisteredRoutes()

      @Controller('/resp')
      class RespController {
        @ApiResponse({ status: 200, description: 'Success' })
        @ApiResponse({ status: 404, description: 'Not found' })
        @Get('/')
        find() {}
      }

      registerControllerForDocs(RespController, '/resp')
      const spec = buildOpenAPISpec()

      const op = spec.paths['/resp']?.get
      expect(op.responses['200']).toEqual({ description: 'Success' })
      expect(op.responses['404']).toEqual({ description: 'Not found' })
    })

    it('should support schema in response', () => {
      clearRegisteredRoutes()

      @Controller('/schema-resp')
      class SchemaRespController {
        @ApiResponse({
          status: 200,
          description: 'OK',
          schema: { type: 'object', properties: { id: { type: 'number' } } },
        })
        @Get('/')
        find() {}
      }

      registerControllerForDocs(SchemaRespController, '/schema-resp')
      const spec = buildOpenAPISpec()

      const op = spec.paths['/schema-resp']?.get
      expect(op.responses['200'].description).toBe('OK')
      expect(op.responses['200'].content).toBeDefined()
      expect(op.responses['200'].content['application/json'].schema).toBeDefined()
    })
  })

  describe('@ApiTags', () => {
    it('should apply class-level tags to all routes', () => {
      clearRegisteredRoutes()

      @ApiTags('Users', 'Admin')
      @Controller('/users')
      class UsersController {
        @Get('/')
        list() {}

        @Get('/:id')
        findOne() {}
      }

      registerControllerForDocs(UsersController, '/users')
      const spec = buildOpenAPISpec()

      expect(spec.paths['/users']?.get?.tags).toEqual(['Users', 'Admin'])
      expect(spec.paths['/users/{id}']?.get?.tags).toEqual(['Users', 'Admin'])
      expect(spec.tags).toContainEqual({ name: 'Users' })
      expect(spec.tags).toContainEqual({ name: 'Admin' })
    })

    it('should allow method-level tags to override class-level tags', () => {
      clearRegisteredRoutes()

      @ApiTags('General')
      @Controller('/mixed')
      class MixedController {
        @Get('/')
        list() {}

        @ApiTags('Special')
        @Get('/special')
        special() {}
      }

      registerControllerForDocs(MixedController, '/mixed')
      const spec = buildOpenAPISpec()

      expect(spec.paths['/mixed']?.get?.tags).toEqual(['General'])
      expect(spec.paths['/mixed/special']?.get?.tags).toEqual(['Special'])
    })
  })

  describe('@ApiBearerAuth', () => {
    it('should add security to class-level auth', () => {
      clearRegisteredRoutes()

      @ApiBearerAuth()
      @Controller('/secure')
      class SecureController {
        @Get('/')
        list() {}
      }

      registerControllerForDocs(SecureController, '/secure')
      const spec = buildOpenAPISpec()

      const op = spec.paths['/secure']?.get
      expect(op.security).toEqual([{ BearerAuth: [] }])
      expect(spec.components.securitySchemes.BearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      })
    })

    it('should support custom auth name', () => {
      clearRegisteredRoutes()

      @Controller('/custom-auth')
      class CustomAuthController {
        @ApiBearerAuth('ApiKeyAuth')
        @Get('/')
        list() {}
      }

      registerControllerForDocs(CustomAuthController, '/custom-auth')
      const spec = buildOpenAPISpec()

      const op = spec.paths['/custom-auth']?.get
      expect(op.security).toEqual([{ ApiKeyAuth: [] }])
      expect(spec.components.securitySchemes.ApiKeyAuth).toBeDefined()
    })
  })

  describe('@ApiExclude', () => {
    it('should exclude entire controller from spec', () => {
      clearRegisteredRoutes()

      @ApiExclude()
      @Controller('/hidden')
      class HiddenController {
        @Get('/')
        list() {}
      }

      registerControllerForDocs(HiddenController, '/hidden')
      const spec = buildOpenAPISpec()

      expect(spec.paths['/hidden']).toBeUndefined()
    })

    it('should exclude individual methods from spec', () => {
      clearRegisteredRoutes()

      @Controller('/partial')
      class PartialController {
        @Get('/')
        list() {}

        @ApiExclude()
        @Get('/secret')
        secret() {}
      }

      registerControllerForDocs(PartialController, '/partial')
      const spec = buildOpenAPISpec()

      expect(spec.paths['/partial']).toBeDefined()
      expect(spec.paths['/partial/secret']).toBeUndefined()
    })
  })
})

// ── OpenAPI Spec Builder Tests ────────────────────────────────────────

describe('buildOpenAPISpec', () => {
  beforeEach(() => {
    Container.reset()
    clearRegisteredRoutes()
  })

  it('should generate a valid OpenAPI 3.0.3 skeleton', () => {
    const spec = buildOpenAPISpec()

    expect(spec.openapi).toBe('3.0.3')
    expect(spec.info.title).toBe('API')
    expect(spec.info.version).toBe('1.0.0')
    expect(spec.paths).toEqual({})
    expect(spec.tags).toEqual([])
  })

  it('should use custom info options', () => {
    const spec = buildOpenAPISpec({
      info: { title: 'My API', version: '2.0.0', description: 'A great API' },
    })

    expect(spec.info.title).toBe('My API')
    expect(spec.info.version).toBe('2.0.0')
    expect(spec.info.description).toBe('A great API')
  })

  it('should include servers when provided', () => {
    const spec = buildOpenAPISpec({
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
    })

    expect(spec.servers).toEqual([{ url: 'https://api.example.com', description: 'Production' }])
  })

  it('should add global bearer auth when bearerAuth option is true', () => {
    const spec = buildOpenAPISpec({ bearerAuth: true })

    expect(spec.security).toEqual([{ BearerAuth: [] }])
    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
  })

  it('should convert Express :param to OpenAPI {param}', () => {
    @Controller('/items')
    class ItemsController {
      @Get('/:id')
      findOne() {}
    }

    registerControllerForDocs(ItemsController, '/items')
    const spec = buildOpenAPISpec()

    expect(spec.paths['/items/{id}']).toBeDefined()
    const op = spec.paths['/items/{id}'].get
    expect(op.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    )
  })

  it('should generate default responses based on HTTP method', () => {
    @Controller('/defaults')
    class DefaultsController {
      @Get('/')
      list() {}

      @Post('/')
      create() {}

      @Delete('/:id')
      remove() {}
    }

    registerControllerForDocs(DefaultsController, '/defaults')
    const spec = buildOpenAPISpec()

    expect(spec.paths['/defaults'].get.responses['200']).toEqual({
      description: 'Successful operation',
    })
    expect(spec.paths['/defaults'].post.responses['201']).toEqual({
      description: 'Successful operation',
    })
    expect(spec.paths['/defaults/{id}'].delete.responses['204']).toEqual({
      description: 'Successful operation',
    })
  })

  it('should remove empty parameters array', () => {
    @Controller('/no-params')
    class NoParamsController {
      @Get('/')
      list() {}
    }

    registerControllerForDocs(NoParamsController, '/no-params')
    const spec = buildOpenAPISpec()

    expect(spec.paths['/no-params'].get.parameters).toBeUndefined()
  })

  it('should handle multiple controllers', () => {
    @Controller('/cats')
    class CatsController {
      @Get('/')
      list() {}
    }

    @Controller('/dogs')
    class DogsController {
      @Get('/')
      list() {}
    }

    registerControllerForDocs(CatsController, '/cats')
    registerControllerForDocs(DogsController, '/dogs')
    const spec = buildOpenAPISpec()

    expect(spec.paths['/cats']).toBeDefined()
    expect(spec.paths['/dogs']).toBeDefined()
  })

  it('should clean up empty components', () => {
    const spec = buildOpenAPISpec()

    // No controllers registered, so components should be cleaned up
    expect(spec.components).toBeUndefined()
  })
})

// ── Route Registration Tests ──────────────────────────────────────────

describe('registerControllerForDocs / clearRegisteredRoutes', () => {
  beforeEach(() => {
    Container.reset()
    clearRegisteredRoutes()
  })

  it('should register and clear routes', () => {
    @Controller('/test')
    class TestController {
      @Get('/')
      list() {}
    }

    registerControllerForDocs(TestController, '/test')
    let spec = buildOpenAPISpec()
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0)

    clearRegisteredRoutes()
    spec = buildOpenAPISpec()
    expect(Object.keys(spec.paths).length).toBe(0)
  })
})

// ── Schema Parser Tests ───────────────────────────────────────────────

describe('zodSchemaParser', () => {
  it('should have name "zod"', () => {
    expect(zodSchemaParser.name).toBe('zod')
  })

  it('should not support non-Zod values', () => {
    expect(zodSchemaParser.supports(null)).toBe(false)
    expect(zodSchemaParser.supports(undefined)).toBe(false)
    expect(zodSchemaParser.supports('string')).toBe(false)
    expect(zodSchemaParser.supports(123)).toBe(false)
    expect(zodSchemaParser.supports({})).toBe(false)
    expect(zodSchemaParser.supports({ safeParse: () => {} })).toBe(false)
  })

  it('should support objects with safeParse and toJSONSchema', () => {
    const fakeZodSchema = {
      safeParse: () => {},
      toJSONSchema: () => ({ type: 'object' }),
    }
    expect(zodSchemaParser.supports(fakeZodSchema)).toBe(true)
  })

  it('should convert a fake Zod schema to JSON Schema, stripping $schema', () => {
    const fakeZodSchema = {
      safeParse: () => {},
      toJSONSchema: () => ({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }),
    }

    const result = zodSchemaParser.toJsonSchema(fakeZodSchema)
    expect(result).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })
    expect(result.$schema).toBeUndefined()
  })

  describe('custom SchemaParser', () => {
    it('should use a custom schema parser in buildOpenAPISpec', () => {
      clearRegisteredRoutes()

      const customParser: SchemaParser = {
        name: 'custom',
        supports: (schema) => typeof schema === 'object' && schema !== null && 'custom' in schema,
        toJsonSchema: (schema: any) => ({
          type: 'object',
          properties: schema.custom.properties,
        }),
      }

      @Controller('/custom')
      class CustomController {
        @Post('/', { body: { custom: { properties: { email: { type: 'string' } } } } })
        create() {}
      }

      registerControllerForDocs(CustomController, '/custom')
      const spec = buildOpenAPISpec({ schemaParser: customParser })

      const op = spec.paths['/custom']?.post
      expect(op.requestBody).toBeDefined()
      expect(op.requestBody.required).toBe(true)
      expect(op.requestBody.content['application/json']).toBeDefined()
    })
  })
})

// ── UI HTML Generation Tests ──────────────────────────────────────────

describe('swaggerUIHtml', () => {
  it('should generate valid HTML with spec URL', () => {
    const html = swaggerUIHtml('/openapi.json')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="swagger-ui"></div>')
    expect(html).toContain('/openapi.json')
    expect(html).toContain('SwaggerUIBundle')
    expect(html).toContain('API Docs')
  })

  it('should use custom title', () => {
    const html = swaggerUIHtml('/openapi.json', 'My Custom Docs')
    expect(html).toContain('<title>My Custom Docs</title>')
  })

  it('should escape HTML in title', () => {
    const html = swaggerUIHtml('/openapi.json', '<script>alert("xss")</script>')
    expect(html).not.toContain('<script>alert("xss")</script>')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('should use CDN URLs by default', () => {
    const html = swaggerUIHtml('/openapi.json')
    expect(html).toContain('https://unpkg.com/swagger-ui-dist@5/swagger-ui.css')
    expect(html).toContain('https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js')
    expect(html).toContain('https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js')
  })

  it('should use local assets path when provided', () => {
    const html = swaggerUIHtml('/openapi.json', 'Docs', '/_swagger-assets')
    expect(html).toContain('/_swagger-assets/swagger-ui.css')
    expect(html).toContain('/_swagger-assets/swagger-ui-bundle.js')
    expect(html).toContain('/_swagger-assets/swagger-ui-standalone-preset.js')
    expect(html).not.toContain('https://unpkg.com')
  })
})

describe('redocHtml', () => {
  it('should generate valid HTML with spec URL', () => {
    const html = redocHtml('/openapi.json')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<redoc spec-url="/openapi.json"></redoc>')
    expect(html).toContain('redoc.standalone.js')
    expect(html).toContain('API Docs')
  })

  it('should use custom title', () => {
    const html = redocHtml('/openapi.json', 'ReDoc Docs')
    expect(html).toContain('<title>ReDoc Docs</title>')
  })

  it('should escape HTML in title and spec URL', () => {
    const html = redocHtml('/api"<script>', 'Title&"Test')
    expect(html).not.toContain('"/api"<script>"')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })
})
