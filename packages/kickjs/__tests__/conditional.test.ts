import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { normalizeEtag } from '../src/http/conditional'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  Container,
  Controller,
  Get,
  Put,
  evaluatePreconditions,
  expressRuntime,
  type RequestContext,
} from '../src/index'

const UPDATED = new Date('2026-10-01T12:00:00.500Z')

describe('evaluatePreconditions', () => {
  const v = { etag: 'v2', lastModified: UPDATED }
  const get = (headers: Record<string, string>) => evaluatePreconditions('GET', headers, v)
  const put = (headers: Record<string, string>) => evaluatePreconditions('PUT', headers, v)

  it('normalizes bare tags, keeping a W/ prefix weak', () => {
    expect(normalizeEtag('v1')).toBe('"v1"')
    expect(normalizeEtag('"v1"')).toBe('"v1"')
    expect(normalizeEtag('W/v1')).toBe('W/"v1"')
    expect(normalizeEtag('W/"v1"')).toBe('W/"v1"')
    // A weak validator never satisfies If-Match (strong comparison).
    expect(evaluatePreconditions('PUT', { 'if-match': '"v1"' }, { etag: 'W/v1' })).toBe(412)
  })

  it('If-None-Match: weak comparison, lists and *', () => {
    expect(get({ 'if-none-match': '"v2"' })).toBe(304)
    expect(get({ 'if-none-match': 'W/"v2"' })).toBe(304)
    expect(get({ 'if-none-match': '"v1", "v2"' })).toBe(304)
    expect(get({ 'if-none-match': '*' })).toBe(304)
    expect(get({ 'if-none-match': '"v1"' })).toBe(200)
    expect(put({ 'if-none-match': '*' })).toBe(412)
  })

  it('If-Modified-Since: second precision, ignored when If-None-Match is present', () => {
    expect(get({ 'if-modified-since': UPDATED.toUTCString() })).toBe(304)
    expect(get({ 'if-modified-since': new Date(UPDATED.getTime() - 1000).toUTCString() })).toBe(200)
    expect(get({ 'if-none-match': '"v1"', 'if-modified-since': UPDATED.toUTCString() })).toBe(200)
    expect(get({ 'if-modified-since': 'not a date' })).toBe(200)
  })

  it('If-Match: strong comparison; If-Unmodified-Since only without it', () => {
    expect(put({ 'if-match': '"v2"' })).toBe(200)
    expect(put({ 'if-match': 'W/"v2"' })).toBe(412)
    expect(put({ 'if-match': '"v1"' })).toBe(412)
    expect(put({ 'if-match': '*' })).toBe(200)
    expect(put({ 'if-unmodified-since': new Date(UPDATED.getTime() - 1000).toUTCString() })).toBe(
      412,
    )
    expect(put({ 'if-unmodified-since': UPDATED.toUTCString() })).toBe(200)
  })
})

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`ctx.conditional — ${name}`, () => {
    beforeEach(() => Container.reset())

    it('answers 304 to a current copy and 412 to a stale write', async () => {
      let loads = 0
      @Controller()
      class C {
        @Get('/post')
        show(ctx: RequestContext) {
          if (ctx.conditional({ etag: 'v2', lastModified: UPDATED })) return
          loads++
          ctx.json({ title: 'hi' })
        }
        @Put('/post')
        update(ctx: RequestContext) {
          if (ctx.conditional({ etag: 'v2' })) return
          ctx.json({ saved: true })
        }
      }
      const app = new Application({
        runtime: runtime(),
        modules: [{ routes: () => ({ path: '/c', controller: C }) } as never],
      })
      await app.setup()
      const http = request(app.handle.bind(app))

      const first = await http.get('/api/v1/c/post').expect(200)
      expect(first.headers.etag).toBe('"v2"')
      expect(first.headers['last-modified']).toBe(UPDATED.toUTCString())

      const again = await http.get('/api/v1/c/post').set('If-None-Match', '"v2"').expect(304)
      expect(again.text).toBe('')
      expect(again.headers.etag).toBe('"v2"')
      expect(loads).toBe(1)

      const stale = await http.put('/api/v1/c/post').set('If-Match', '"v1"').send({}).expect(412)
      expect(stale.body).toMatchObject({ status: 412, title: 'Precondition Failed' })
      await http.put('/api/v1/c/post').set('If-Match', '"v2"').send({}).expect(200)
    })
  })
