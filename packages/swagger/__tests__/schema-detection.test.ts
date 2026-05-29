/**
 * Swagger end-to-end: auto-detect Zod / Valibot / Yup schemas through
 * the `@forinda/kickjs-schema` `detectSchema` pipeline.
 *
 * The default `zodSchemaParser` (misnamed for back-compat — it's
 * actually the kickjs-schema-driven parser) routes:
 *
 *   - KickSchema-shaped objects                → passthrough
 *   - Zod v3/v4                                → `fromZod`
 *   - Valibot                                  → `fromValibot`
 *   - Yup                                      → `fromYup`
 *   - Anything implementing Standard Schema v1 → `fromStandardSchema`
 *   - Plain functions                          → wrapped as validators
 *
 * These tests lock the integration so a regression in any adapter's
 * `toJsonSchema` output surfaces as a swagger spec test failure, not as
 * a confusing `{ type: 'object' }`-with-no-properties shape in the
 * generated OpenAPI doc.
 *
 * @module @forinda/kickjs-swagger/__tests__/schema-detection
 */

import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as v from 'valibot'
import * as yup from 'yup'
import {
  buildOpenAPISpec,
  clearRegisteredRoutes,
  registerControllerForDocs,
  zodSchemaParser,
} from '@forinda/kickjs-swagger'
import { Container, Controller, Post } from '@forinda/kickjs'

describe('swagger — detectSchema integration', () => {
  beforeEach(() => {
    Container.reset()
    clearRegisteredRoutes()
  })

  it('detects + converts a Zod schema attached via @Post body', () => {
    const ZodCreateUser = z.object({
      name: z.string(),
      email: z.email(),
    })

    @Controller()
    class ZodCtrl {
      @Post('/', { body: ZodCreateUser })
      create() {}
    }

    registerControllerForDocs(ZodCtrl, '/users')
    const spec = buildOpenAPISpec()

    const op = spec.paths['/users']?.post
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody.required).toBe(true)

    const schemaRef = op.requestBody.content['application/json'].schema
    const ref = schemaRef.$ref as string | undefined
    const inlined = ref
      ? spec.components.schemas[ref.replace('#/components/schemas/', '')]
      : schemaRef
    expect(inlined.type).toBe('object')
    expect(Object.keys(inlined.properties)).toEqual(expect.arrayContaining(['name', 'email']))
  })

  it('detects + converts a Valibot schema attached via @Post body', () => {
    const ValibotCreateUser = v.object({
      name: v.string(),
      email: v.pipe(v.string(), v.email()),
    })

    @Controller()
    class ValibotCtrl {
      @Post('/', { body: ValibotCreateUser })
      create() {}
    }

    registerControllerForDocs(ValibotCtrl, '/users')
    const spec = buildOpenAPISpec()

    const op = spec.paths['/users']?.post
    expect(op.requestBody).toBeDefined()
    const schemaRef = op.requestBody.content['application/json'].schema
    const ref = schemaRef.$ref as string | undefined
    const inlined = ref
      ? spec.components.schemas[ref.replace('#/components/schemas/', '')]
      : schemaRef
    expect(inlined.type).toBe('object')
    expect(Object.keys(inlined.properties)).toEqual(expect.arrayContaining(['name', 'email']))
  })

  it('detects + converts a Yup schema attached via @Post body', () => {
    const YupCreateUser = yup.object({
      name: yup.string().required(),
      email: yup.string().email().required(),
    })

    @Controller()
    class YupCtrl {
      @Post('/', { body: YupCreateUser })
      create() {}
    }

    registerControllerForDocs(YupCtrl, '/users')
    const spec = buildOpenAPISpec()

    const op = spec.paths['/users']?.post
    expect(op.requestBody).toBeDefined()
    const schemaRef = op.requestBody.content['application/json'].schema
    const ref = schemaRef.$ref as string | undefined
    const inlined = ref
      ? spec.components.schemas[ref.replace('#/components/schemas/', '')]
      : schemaRef
    expect(inlined.type).toBe('object')
    expect(Object.keys(inlined.properties)).toEqual(expect.arrayContaining(['name', 'email']))
  })

  it('parser.supports() returns true for all three adapter shapes', () => {
    expect(zodSchemaParser.supports(z.object({ a: z.string() }))).toBe(true)
    expect(zodSchemaParser.supports(v.object({ a: v.string() }))).toBe(true)
    expect(zodSchemaParser.supports(yup.object({ a: yup.string() }))).toBe(true)
  })

  it('parser.toJsonSchema() emits non-empty properties for all three adapters', () => {
    const zodJson = zodSchemaParser.toJsonSchema(z.object({ a: z.string() }))
    const valibotJson = zodSchemaParser.toJsonSchema(v.object({ a: v.string() }))
    const yupJson = zodSchemaParser.toJsonSchema(yup.object({ a: yup.string() }))

    for (const json of [zodJson, valibotJson, yupJson]) {
      expect(json.type).toBe('object')
      const props = json.properties as Record<string, unknown>
      expect(props).toBeDefined()
      expect(Object.keys(props)).toContain('a')
    }
  })
})
