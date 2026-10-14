import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { validate, type ValidationErrorFactory } from '../src/http/middleware/validate'
import { HttpException } from '../src/core/errors'
import { Application, Container, Controller, Post, RequestContext } from '../src/index'

const run = (body: unknown, validationError?: ValidationErrorFactory) => {
  const next = vi.fn()
  validate({ body: z.object({ title: z.string().min(1) }) }, { validationError })(
    { body } as never,
    {} as never,
    next,
  )
  return next.mock.calls[0][0]
}

describe('validation error factory', () => {
  it('defaults to a 422 HttpException with field details', () => {
    const err = run({ title: '' })
    expect(err).toBeInstanceOf(HttpException)
    expect(err.status).toBe(422)
    expect(err.details).toEqual([{ field: 'title', message: expect.any(String) }])
  })

  it('uses what the factory throws, as well as what it returns', () => {
    const custom = new Error('nope')
    expect(
      run({ title: '' }, () => {
        throw custom
      }),
    ).toBe(custom)
  })

  it('is not consulted for a valid request', () => {
    const factory = vi.fn()
    expect(run({ title: 'ok' }, factory)).toBeUndefined()
    expect(factory).not.toHaveBeenCalled()
  })

  it('belongs to each app — a second app does not change the first', async () => {
    Container.reset()
    @Controller()
    class C {
      @Post('/', { body: z.object({ title: z.string().min(1) }) })
      create(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }
    const make = (validationError?: ValidationErrorFactory) =>
      new Application({
        validationError,
        modules: [{ routes: () => ({ path: '/v', controller: C }) } as never],
      })

    const custom = make(() => new HttpException(400, 'custom'))
    await custom.setup()
    const plain = make()
    await plain.setup()

    await request(custom.handle.bind(custom)).post('/api/v1/v').send({ title: '' }).expect(400)
    await request(plain.handle.bind(plain)).post('/api/v1/v').send({ title: '' }).expect(422)
  })
})
