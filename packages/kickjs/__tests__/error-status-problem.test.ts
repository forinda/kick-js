/**
 * An error that isn't an HttpException but declares a status — a database
 * UniqueViolationError (409), a BYO auth check's `status: 401` — is a
 * client error: RFC 9457 problem+json, not a bare `{ message }`. A declared
 * 5xx keeps its status but never leaks its message in production.
 */
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../src/http/middleware/error-handler'

const withStatus = (message: string, status: number) =>
  Object.assign(new Error(message), { status })

function appThrowing(err: Error) {
  const app = express()
  app.get('/boom', (_req, _res, next) => next(err))
  app.use(errorHandler())
  return app
}

const env = process.env.NODE_ENV
afterEach(() => {
  process.env.NODE_ENV = env
})

describe('errors that declare a status', () => {
  it('answers a 4xx as problem+json with the message as detail', async () => {
    const res = await request(
      appThrowing(withStatus('Duplicate value for users (email)', 409)),
    ).get('/boom')
    expect(res.status).toBe(409)
    expect(res.headers['content-type']).toContain('application/problem+json')
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Duplicate value for users (email)',
    })
  })

  it('reads statusCode too', async () => {
    const err = Object.assign(new Error('Sign in first'), { statusCode: 401 })
    const res = await request(appThrowing(err)).get('/boom')
    expect(res.body).toMatchObject({ status: 401, title: 'Unauthorized', detail: 'Sign in first' })
  })

  it('keeps a declared 5xx but not its message, in production', async () => {
    process.env.NODE_ENV = 'production'
    const res = await request(appThrowing(withStatus('upstream at 10.0.0.5 refused', 503))).get(
      '/boom',
    )
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5')
  })
})
