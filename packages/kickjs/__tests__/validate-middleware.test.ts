import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { validate } from '../src/http/middleware/validate'
import { HttpException } from '../src/core'

function schemaThatFails(message: string, path: (string | number)[] = ['name']) {
  return {
    safeParse() {
      return {
        success: false,
        error: {
          name: 'ZodError',
          issues: [{ path, message, code: 'invalid_type' }],
        },
      }
    },
  }
}

function schemaThatPasses<T>(data: T) {
  return {
    safeParse() {
      return { success: true, data }
    },
  }
}

describe('validate() middleware', () => {
  it('forwards schema failures via next(err) so onError sees them', async () => {
    const app = express()
    app.use(express.json())
    app.post(
      '/users',
      validate({ body: schemaThatFails('Name is required') }),
      (_req, res) => res.json({ ok: true }),
    )

    const sawError = { called: false, status: 0, message: '', details: undefined as unknown }
    app.use((err: any, _req: any, res: any, _next: any) => {
      sawError.called = true
      sawError.status = err.status
      sawError.message = err.message
      sawError.details = err.details
      res.status(err.status ?? 500).json({
        success: false,
        error: 'VALIDATION',
        message: err.message,
        details: err.details,
      })
    })

    const res = await request(app).post('/users').send({})

    expect(sawError.called).toBe(true)
    expect(sawError.status).toBe(422)
    expect(sawError.message).toBe('Name is required')
    expect(sawError.details).toEqual([{ field: 'name', message: 'Name is required' }])

    expect(res.status).toBe(422)
    expect(res.body).toEqual({
      success: false,
      error: 'VALIDATION',
      message: 'Name is required',
      details: [{ field: 'name', message: 'Name is required' }],
    })
  })

  it('passes HttpException through with 422 status', async () => {
    const app = express()
    app.use(express.json())
    app.post(
      '/users',
      validate({ body: schemaThatFails('Name is required') }),
      (_req, res) => res.json({ ok: true }),
    )

    let captured: any
    app.use((err: any, _req: any, res: any, _next: any) => {
      captured = err
      res.status(500).end()
    })

    await request(app).post('/users').send({})
    expect(captured).toBeInstanceOf(HttpException)
    expect(captured.status).toBe(422)
  })

  it('uses the generic message for query parameter failures (preserved behaviour)', async () => {
    const app = express()
    app.get(
      '/search',
      validate({ query: schemaThatFails('Must be a number', ['page']) }),
      (_req, res) => res.json({ ok: true }),
    )

    let captured: any
    app.use((err: any, _req: any, res: any, _next: any) => {
      captured = err
      res.status(err.status).json({ message: err.message, errors: err.details })
    })

    const res = await request(app).get('/search?page=abc')
    expect(res.status).toBe(422)
    expect(captured.message).toBe('Invalid query parameters')
    expect(res.body.errors).toEqual([{ field: 'page', message: 'Must be a number' }])
  })

  it('uses the generic message for path parameter failures (preserved behaviour)', async () => {
    const app = express()
    app.get(
      '/users/:id',
      validate({ params: schemaThatFails('Must be UUID', ['id']) }),
      (_req, res) => res.json({ ok: true }),
    )

    let captured: any
    app.use((err: any, _req: any, res: any, _next: any) => {
      captured = err
      res.status(err.status).end()
    })

    await request(app).get('/users/abc')
    expect(captured.message).toBe('Invalid path parameters')
  })

  it('assigns parsed data to req.body when validation passes', async () => {
    const app = express()
    app.use(express.json())
    let observed: any = null
    app.post(
      '/users',
      validate({ body: schemaThatPasses({ name: 'parsed' }) }),
      (req, res) => {
        observed = req.body
        res.json({ ok: true })
      },
    )

    const res = await request(app).post('/users').send({ name: 'ignored' })
    expect(res.status).toBe(200)
    expect(observed).toEqual({ name: 'parsed' })
  })

  it('assigns parsed data to req.query on Express 5 (getter-only property)', async () => {
    // Regression for #130 — Express 5 installs req.query as a getter, so
    // direct assignment throws in strict mode. validate() must use
    // defineProperty so validated query data reaches the handler.
    const app = express()
    let observed: any = null
    app.get(
      '/search',
      validate({ query: schemaThatPasses({ page: 2, limit: 50 }) }),
      (req, res) => {
        observed = req.query
        res.json({ ok: true })
      },
    )

    const res = await request(app).get('/search?page=abc')
    expect(res.status).toBe(200)
    expect(observed).toEqual({ page: 2, limit: 50 })
  })

  it('assigns parsed data to req.params when validation passes', async () => {
    const app = express()
    let observed: any = null
    app.get(
      '/users/:id',
      validate({ params: schemaThatPasses({ id: 'normalized-uuid' }) }),
      (req, res) => {
        observed = req.params
        res.json({ ok: true })
      },
    )

    const res = await request(app).get('/users/raw-id')
    expect(res.status).toBe(200)
    expect(observed).toEqual({ id: 'normalized-uuid' })
  })

  it('still calls next(err) when safeParse itself throws', async () => {
    const throwingSchema = {
      safeParse() {
        throw new Error('schema blew up')
      },
    }

    const app = express()
    app.use(express.json())
    app.post('/users', validate({ body: throwingSchema }), (_req, res) =>
      res.json({ ok: true }),
    )

    let captured: any
    app.use((err: any, _req: any, res: any, _next: any) => {
      captured = err
      res.status(500).end()
    })

    await request(app).post('/users').send({})
    expect(captured.message).toBe('schema blew up')
  })
})
