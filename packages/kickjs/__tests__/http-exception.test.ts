import 'reflect-metadata'
import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { HttpException, HttpStatus } from '../src/core'
import { errorHandler } from '../src/http/middleware/error-handler'

function appThrowing(err: Error) {
  const app = express()
  app.use(express.json())
  app.get('/boom', (_req, _res, next) => next(err))
  app.use(errorHandler())
  return app
}

describe('HttpException', () => {
  describe('headers (forinda/kick-js#106)', () => {
    it('propagates a Retry-After header from the exception', async () => {
      const err = new HttpException(HttpStatus.TOO_MANY_REQUESTS, 'slow down', undefined, {
        'Retry-After': '60',
      })
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(429)
      expect(res.headers['retry-after']).toBe('60')
      expect(res.body).toEqual({ message: 'slow down' })
    })

    it('propagates a WWW-Authenticate header on 401', async () => {
      const err = new HttpException(HttpStatus.UNAUTHORIZED, 'auth required', undefined, {
        'WWW-Authenticate': 'Bearer realm="api"',
      })
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toBe('Bearer realm="api"')
    })

    it('propagates an Allow header on 405', async () => {
      const err = new HttpException(HttpStatus.METHOD_NOT_ALLOWED, 'nope', undefined, {
        Allow: 'GET, POST',
      })
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(405)
      expect(res.headers['allow']).toBe('GET, POST')
    })

    it('still works without headers (back-compat)', async () => {
      const err = new HttpException(404, 'Not Found')
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ message: 'Not Found' })
    })
  })

  describe('factory helpers with header arguments', () => {
    it('tooManyRequests(msg, retryAfterSeconds) sets Retry-After', async () => {
      const err = HttpException.tooManyRequests('throttled', 30)
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(429)
      expect(res.headers['retry-after']).toBe('30')
    })

    it('unauthorized(msg, wwwAuthenticate) sets WWW-Authenticate', async () => {
      const err = HttpException.unauthorized('auth required', 'Bearer realm="api"')
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toBe('Bearer realm="api"')
    })

    it('methodNotAllowed(allowedMethods) sets Allow', async () => {
      const err = HttpException.methodNotAllowed(['GET', 'POST'])
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(405)
      expect(res.headers['allow']).toBe('GET, POST')
    })

    it('serviceUnavailable(msg, retryAfterSeconds) sets Retry-After', async () => {
      const err = HttpException.serviceUnavailable('maintenance', 120)
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(503)
      expect(res.headers['retry-after']).toBe('120')
    })
  })

  describe('withHeaders chainable', () => {
    it('returns a new exception with merged headers', async () => {
      const base = HttpException.tooManyRequests('slow', 60)
      const withTrace = base.withHeaders({ 'X-Trace-Id': 'abc-123' })
      const res = await request(appThrowing(withTrace)).get('/boom')
      expect(res.headers['retry-after']).toBe('60')
      expect(res.headers['x-trace-id']).toBe('abc-123')
    })

    it('does not mutate the original exception', () => {
      const base = HttpException.tooManyRequests('slow', 60)
      const baseHeaders = { ...base.headers }
      base.withHeaders({ 'X-Extra': '1' })
      expect(base.headers).toEqual(baseHeaders)
    })
  })

  describe('details accepts arbitrary shapes', () => {
    it('accepts a plain object as details', async () => {
      const details = { reason: 'rate-limit', resetAt: '2026-01-01T00:00:00Z' }
      const err = new HttpException(429, 'throttled', details)
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.body.errors).toEqual(details)
    })

    it('accepts a string as details', async () => {
      const err = new HttpException(400, 'bad', 'free-form context string')
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.body.errors).toBe('free-form context string')
    })

    it('accepts a heterogeneous array as details', async () => {
      const details = [{ field: 'email', message: 'invalid' }, 'extra context', 42]
      const err = new HttpException(422, 'bad', details)
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.body.errors).toEqual(details)
    })

    it('omits errors when details is undefined', async () => {
      const err = new HttpException(404, 'Not Found')
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.body).not.toHaveProperty('errors')
    })
  })

  describe('details visibility — default handler hides details in production', () => {
    const originalEnv = process.env.NODE_ENV

    afterEach(() => {
      process.env.NODE_ENV = originalEnv
    })

    it('hides details from the response body when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production'
      const err = new HttpException(500, 'something broke', { dbError: 'syntax error at line 12' })
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ message: 'something broke' })
      expect(res.body).not.toHaveProperty('errors')
    })

    it('hides validation details too in production (strict policy)', async () => {
      process.env.NODE_ENV = 'production'
      const err = HttpException.unprocessable('bad', [
        { field: 'email', message: 'invalid', code: 'invalid_string' },
      ])
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.status).toBe(422)
      expect(res.body.message).toBe('bad')
      expect(res.body).not.toHaveProperty('errors')
    })

    it('keeps headers in production even when details are hidden', async () => {
      process.env.NODE_ENV = 'production'
      const err = HttpException.tooManyRequests('throttled', 60)
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.headers['retry-after']).toBe('60')
      expect(res.body).not.toHaveProperty('errors')
    })

    it('shows details in development', async () => {
      process.env.NODE_ENV = 'development'
      const err = HttpException.unprocessable('bad', [
        { field: 'email', message: 'invalid', code: 'invalid_string' },
      ])
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.body.errors).toHaveLength(1)
    })

    it('shows details when NODE_ENV is unset (treated as non-prod)', async () => {
      delete process.env.NODE_ENV
      const err = new HttpException(400, 'bad', { reason: 'test' })
      const res = await request(appThrowing(err)).get('/boom')
      expect(res.body.errors).toEqual({ reason: 'test' })
    })
  })
})
