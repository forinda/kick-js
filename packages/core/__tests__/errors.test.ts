import { describe, it, expect } from 'vitest'
import { HttpException, HttpStatus } from '@forinda/kickjs-core'

describe('HttpException', () => {
  it('creates an exception with status, message, and details', () => {
    const details = [{ field: 'email', message: 'invalid', code: 'invalid_string' }]
    const err = new HttpException(422, 'Validation failed', details)

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(HttpException)
    expect(err.status).toBe(422)
    expect(err.message).toBe('Validation failed')
    expect(err.details).toEqual(details)
    expect(err.name).toBe('HttpException')
  })

  it('works without details', () => {
    const err = new HttpException(500, 'Server error')
    expect(err.status).toBe(500)
    expect(err.details).toBeUndefined()
  })

  // ── Factory Methods ─────────────────────────────────────────────────

  it('.badRequest() creates 400', () => {
    const err = HttpException.badRequest()
    expect(err.status).toBe(400)
    expect(err.message).toBe('Bad Request')
  })

  it('.badRequest() accepts custom message', () => {
    const err = HttpException.badRequest('Invalid input')
    expect(err.message).toBe('Invalid input')
  })

  it('.unauthorized() creates 401', () => {
    const err = HttpException.unauthorized()
    expect(err.status).toBe(401)
    expect(err.message).toBe('Unauthorized')
  })

  it('.forbidden() creates 403', () => {
    const err = HttpException.forbidden()
    expect(err.status).toBe(403)
    expect(err.message).toBe('Forbidden')
  })

  it('.notFound() creates 404', () => {
    const err = HttpException.notFound()
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not Found')
  })

  it('.conflict() creates 409', () => {
    const err = HttpException.conflict()
    expect(err.status).toBe(409)
    expect(err.message).toBe('Conflict')
  })

  it('.unprocessable() creates 422 with optional details', () => {
    const details = [{ field: 'name', message: 'required' }]
    const err = HttpException.unprocessable('Invalid data', details)
    expect(err.status).toBe(422)
    expect(err.message).toBe('Invalid data')
    expect(err.details).toEqual(details)
  })

  it('.tooManyRequests() creates 429', () => {
    const err = HttpException.tooManyRequests()
    expect(err.status).toBe(429)
    expect(err.message).toBe('Too Many Requests')
  })

  it('.internal() creates 500', () => {
    const err = HttpException.internal()
    expect(err.status).toBe(500)
    expect(err.message).toBe('Internal Server Error')
  })

  // ── fromZodError ────────────────────────────────────────────────────

  it('.fromZodError() converts Zod-like error to 422', () => {
    const zodError = {
      issues: [
        { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
        { path: ['age'], message: 'Expected number', code: 'invalid_type' },
      ],
    }

    const err = HttpException.fromZodError(zodError)
    expect(err.status).toBe(422)
    expect(err.message).toBe('Invalid email') // uses first issue
    expect(err.details).toHaveLength(2)
    expect(err.details![0]).toEqual({
      field: 'email',
      message: 'Invalid email',
      code: 'invalid_string',
    })
    expect(err.details![1]).toEqual({
      field: 'age',
      message: 'Expected number',
      code: 'invalid_type',
    })
  })

  it('.fromZodError() uses custom message when provided', () => {
    const zodError = { issues: [{ path: ['x'], message: 'bad', code: 'custom' }] }
    const err = HttpException.fromZodError(zodError, 'Custom validation message')
    expect(err.message).toBe('Custom validation message')
  })

  it('.fromZodError() handles nested paths', () => {
    const zodError = {
      issues: [{ path: ['address', 'zip'], message: 'Required', code: 'invalid_type' }],
    }
    const err = HttpException.fromZodError(zodError)
    expect(err.details![0].field).toBe('address.zip')
  })

  it('.fromZodError() handles empty issues', () => {
    const zodError = { issues: [] }
    const err = HttpException.fromZodError(zodError)
    expect(err.status).toBe(422)
    expect(err.message).toBe('Validation failed')
    expect(err.details).toEqual([])
  })
})

describe('HttpStatus', () => {
  it('has correct 2xx codes', () => {
    expect(HttpStatus.OK).toBe(200)
    expect(HttpStatus.CREATED).toBe(201)
    expect(HttpStatus.ACCEPTED).toBe(202)
    expect(HttpStatus.NO_CONTENT).toBe(204)
  })

  it('has correct 3xx codes', () => {
    expect(HttpStatus.MOVED_PERMANENTLY).toBe(301)
    expect(HttpStatus.FOUND).toBe(302)
    expect(HttpStatus.NOT_MODIFIED).toBe(304)
    expect(HttpStatus.TEMPORARY_REDIRECT).toBe(307)
    expect(HttpStatus.PERMANENT_REDIRECT).toBe(308)
  })

  it('has correct 4xx codes', () => {
    expect(HttpStatus.BAD_REQUEST).toBe(400)
    expect(HttpStatus.UNAUTHORIZED).toBe(401)
    expect(HttpStatus.FORBIDDEN).toBe(403)
    expect(HttpStatus.NOT_FOUND).toBe(404)
    expect(HttpStatus.CONFLICT).toBe(409)
    expect(HttpStatus.UNPROCESSABLE_ENTITY).toBe(422)
    expect(HttpStatus.TOO_MANY_REQUESTS).toBe(429)
  })

  it('has correct 5xx codes', () => {
    expect(HttpStatus.INTERNAL_SERVER_ERROR).toBe(500)
    expect(HttpStatus.NOT_IMPLEMENTED).toBe(501)
    expect(HttpStatus.BAD_GATEWAY).toBe(502)
    expect(HttpStatus.SERVICE_UNAVAILABLE).toBe(503)
    expect(HttpStatus.GATEWAY_TIMEOUT).toBe(504)
  })

  it('works with HttpException constructor', () => {
    const err = new HttpException(HttpStatus.NOT_FOUND, 'User not found')
    expect(err.status).toBe(404)
  })
})
