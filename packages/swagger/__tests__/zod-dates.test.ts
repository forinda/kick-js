/**
 * Zod types JSON Schema can't express (dates, bigints, transforms, Maps) must
 * not drop a schema from the spec, nor leak the validator's object into it.
 */
import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ApiResponse,
  buildOpenAPISpec,
  clearRegisteredRoutes,
  registerControllerForDocs,
  type SchemaParser,
} from '@forinda/kickjs-swagger'
import { Controller, Get, Post } from '@forinda/kickjs'

beforeEach(() => clearRegisteredRoutes())

const resolve = (spec: any, s: any) =>
  s.$ref ? spec.components.schemas[s.$ref.split('/').pop()] : s

describe('Zod schemas in the spec', () => {
  it('documents dates, bigints and other unrepresentable types', () => {
    const task = z.object({
      title: z.string(),
      dueAt: z.date(),
      big: z.bigint(),
      tags: z.set(z.string()),
      note: z.string().nullable(),
    })
    @Controller()
    class TaskController {
      @Post('/', { body: task })
      @ApiResponse({ status: 201, description: 'Created', schema: task })
      create() {}

      @Get('/', { query: z.object({ since: z.coerce.date() }) })
      list() {}
    }
    registerControllerForDocs(TaskController, '/tasks')
    const spec = buildOpenAPISpec()

    const post = spec.paths['/tasks'].post
    const body = resolve(spec, post.requestBody.content['application/json'].schema)
    expect(body.properties).toEqual({
      title: { type: 'string' },
      dueAt: { type: 'string', format: 'date-time' },
      big: { type: 'integer', format: 'int64' },
      tags: {},
      // OpenAPI 3.0's form, not draft-2020-12's type: ['string', 'null'].
      note: { type: 'string', nullable: true },
    })
    const created = resolve(spec, post.responses['201'].content['application/json'].schema)
    expect(created.properties.dueAt).toEqual({ type: 'string', format: 'date-time' })

    const since = spec.paths['/tasks'].get.parameters.find((p: any) => p.name === 'since')
    expect(since.schema).toEqual({ type: 'string', format: 'date-time' })
  })

  it('describes a request by what it accepts, a response by what it returns', () => {
    const body = z.object({ count: z.string().transform(Number), page: z.number().default(1) })
    @Controller()
    class PageController {
      @Post('/', { body, response: z.object({ total: z.string().transform(Number) }) })
      create() {}
    }
    registerControllerForDocs(PageController, '/pages')
    const spec = buildOpenAPISpec()
    const post = spec.paths['/pages'].post
    const req = resolve(spec, post.requestBody.content['application/json'].schema)
    expect(req.properties.count).toEqual({ type: 'string' })
    expect(req.required).toEqual(['count']) // page has a default, so it's optional to send
    const res = resolve(spec, post.responses['201'].content['application/json'].schema)
    expect(res.properties.total).toEqual({}) // a transform's result: any value
  })

  it('points a recursive schema at its own component', () => {
    const Category: z.ZodType<any> = z.object({
      name: z.string(),
      get children() {
        return z.array(Category)
      },
    })
    @Controller()
    class CategoryController {
      @Get('/', { response: Category })
      list() {}
    }
    registerControllerForDocs(CategoryController, '/categories')
    const spec = buildOpenAPISpec()
    const ref = spec.paths['/categories'].get.responses['200'].content['application/json'].schema
    const schema = resolve(spec, ref)
    expect(schema.properties.children.items).toEqual(ref)
    expect(JSON.stringify(spec.components.schemas)).not.toContain('"#"')
  })

  it("leaves out a schema that fails to convert, and says so — never the validator's object", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing: SchemaParser = {
      name: 'failing',
      supports: (s) => typeof s === 'object' && s !== null && 'broken' in s,
      toJsonSchema: () => {
        throw new Error('cannot convert')
      },
    }
    @Controller()
    class BrokenController {
      @Get('/')
      @ApiResponse({ status: 200, description: 'OK', schema: { broken: true } as never })
      list() {}
    }
    registerControllerForDocs(BrokenController, '/broken')
    const spec = buildOpenAPISpec({ schemaParser: failing })
    const ok = spec.paths['/broken'].get.responses['200']
    expect(ok.description).toBe('OK')
    expect(ok.content).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GET /broken 200 response'))
    warn.mockRestore()
  })
})
