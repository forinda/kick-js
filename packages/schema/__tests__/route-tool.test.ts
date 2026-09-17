import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as v from 'valibot'
import * as yup from 'yup'
import { buildRouteTool } from '../src/route-tool'

describe('buildRouteTool — input schema', () => {
  it('adds path parameters as required string fields next to body fields', () => {
    const tool = buildRouteTool({
      method: 'put',
      path: '/api/v1/tasks/:id',
      body: z.object({ title: z.string(), done: z.boolean().optional() }),
    })
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        done: { type: 'boolean' },
      },
    })
    expect((tool.inputSchema.required as string[]).toSorted()).toEqual(['id', 'title'])
  })

  it('uses a params schema when the route declares one', () => {
    const tool = buildRouteTool({
      method: 'GET',
      path: '/users/:id',
      params: z.object({ id: z.string().uuid() }),
    })
    expect((tool.inputSchema.properties as Record<string, unknown>).id).toMatchObject({
      type: 'string',
      format: 'uuid',
    })
  })

  it.each([
    ['valibot', v.object({ title: v.string() })],
    ['yup', yup.object({ title: yup.string().required() })],
  ])('reads %s body schemas', (_name, body) => {
    const tool = buildRouteTool({ method: 'POST', path: '/tasks', body })
    expect((tool.inputSchema.properties as Record<string, unknown>).title).toMatchObject({
      type: 'string',
    })
  })

  it('keeps query and body fields apart on a body route', () => {
    const tool = buildRouteTool({
      method: 'POST',
      path: '/tasks',
      query: z.object({ dryRun: z.string().optional() }),
      body: z.object({ title: z.string() }),
    })
    expect(Object.keys(tool.inputSchema.properties as object).toSorted()).toEqual([
      'dryRun',
      'title',
    ])
    expect(tool.toRequest({ title: 'x', dryRun: 'true' })).toEqual({
      url: '/tasks?dryRun=true',
      body: { title: 'x' },
    })
  })

  it('puts a non-object body under a single body property', () => {
    const tool = buildRouteTool({
      method: 'POST',
      path: '/tasks/bulk',
      body: z.array(z.object({ title: z.string() })),
    })
    expect(tool.inputSchema.required).toEqual(['body'])
    expect(tool.toRequest({ body: [{ title: 'a' }] })).toEqual({
      url: '/tasks/bulk',
      body: [{ title: 'a' }],
    })
  })

  it('an input override replaces query/body but keeps path parameters', () => {
    const tool = buildRouteTool({
      method: 'PATCH',
      path: '/tasks/:id',
      body: z.object({ title: z.string() }),
      input: z.object({ status: z.enum(['open', 'done']) }),
    })
    expect(Object.keys(tool.inputSchema.properties as object).toSorted()).toEqual(['id', 'status'])
    expect(tool.toRequest({ id: '7', status: 'done' })).toEqual({
      url: '/tasks/7',
      body: { status: 'done' },
    })
  })

  it('has an empty object schema for a route with no inputs', () => {
    expect(buildRouteTool({ method: 'GET', path: '/health' }).inputSchema).toEqual({
      type: 'object',
      properties: {},
    })
  })
})

describe('buildRouteTool — toRequest', () => {
  it('fills path parameters, encoded, and sends the rest as the body', () => {
    const tool = buildRouteTool({
      method: 'PUT',
      path: '/tasks/:id',
      body: z.object({ title: z.string() }),
    })
    expect(tool.toRequest({ id: 'a b/c', title: 'x' })).toEqual({
      url: '/tasks/a%20b%2Fc',
      body: { title: 'x' },
    })
  })

  it('keeps a path parameter in the body when the body schema declares it', () => {
    const tool = buildRouteTool({
      method: 'PUT',
      path: '/tasks/:id',
      body: z.object({ id: z.string(), title: z.string() }),
    })
    expect(tool.toRequest({ id: '1', title: 'x' }).body).toEqual({ id: '1', title: 'x' })
  })

  it('throws instead of calling a literal :param URL', () => {
    const tool = buildRouteTool({ method: 'DELETE', path: '/tasks/:id' })
    expect(() => tool.toRequest({})).toThrow('Missing path parameter "id" for DELETE /tasks/:id')
  })

  it('sends GET arguments as a query string, arrays as repeated keys', () => {
    const tool = buildRouteTool({
      method: 'GET',
      path: '/tasks',
      query: z.object({ tag: z.array(z.string()), page: z.number(), q: z.string() }),
    })
    expect(tool.toRequest({ tag: ['a', 'b'], page: 2, q: 'x y', skip: undefined })).toEqual({
      url: '/tasks?tag=a&tag=b&page=2&q=x+y',
    })
  })

  it('sends an empty JSON body on a body route called with no arguments', () => {
    expect(buildRouteTool({ method: 'POST', path: '/ping' }).toRequest(undefined)).toEqual({
      url: '/ping',
      body: {},
    })
  })
})
