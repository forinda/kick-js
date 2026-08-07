import { describe, it, expectTypeOf } from 'vitest'

import type { InferHandlerResponse, Reply } from '../src/http/reply'
import type { RequestContext } from '../src/http/context'
import type { PaginatedResponse } from '../src/http/query'

/**
 * Type-level contract for InferHandlerResponse — what `kick typegen` R2
 * emits into `KickRoutes[...].response`. Purely compile-time.
 */

interface User {
  id: string
  name: string
}

describe('InferHandlerResponse (type-level)', () => {
  it('infers plain and async return types', () => {
    expectTypeOf<InferHandlerResponse<(ctx: RequestContext) => User>>().toEqualTypeOf<User>()
    expectTypeOf<InferHandlerResponse<(ctx: RequestContext) => Promise<User[]>>>().toEqualTypeOf<
      User[]
    >()
  })

  it('unwraps Reply<S, T> to T', () => {
    expectTypeOf<
      InferHandlerResponse<(ctx: RequestContext) => Promise<Reply<201, User>>>
    >().toEqualTypeOf<User>()
  })

  it('imperative void handlers stay unknown', () => {
    expectTypeOf<InferHandlerResponse<(ctx: RequestContext) => void>>().toEqualTypeOf<unknown>()
    expectTypeOf<
      InferHandlerResponse<(ctx: RequestContext) => Promise<void>>
    >().toEqualTypeOf<unknown>()
  })

  it('drops undefined members from mixed imperative/return handlers', () => {
    expectTypeOf<
      InferHandlerResponse<(ctx: RequestContext) => Promise<User | undefined>>
    >().toEqualTypeOf<User>()
  })

  it('non-function inputs degrade to unknown', () => {
    expectTypeOf<InferHandlerResponse<string>>().toEqualTypeOf<unknown>()
  })
})

/**
 * Response helpers that send AND return a payload.
 *
 * `ctx.paginate()` used to `return this.json(response)`, handing back the
 * engine's `RuntimeResponse`. The documented usage is
 * `return ctx.paginate(...)`, so typegen emitted `response: RuntimeResponse`
 * into `KickRoutes` and the typed client offered `.status()` / `.setHeader()`
 * where the caller expected `data` and `meta` — confidently wrong rather than
 * merely imprecise.
 *
 * It now returns the payload, so the same return-value inference that handles
 * `return user` and `return reply(201, user)` covers it. No second mechanism
 * beside `reply`.
 */
describe('InferHandlerResponse — response helpers', () => {
  it('infers the paginated payload, not the engine response', () => {
    type Handler = (ctx: RequestContext) => ReturnType<RequestContext['paginate']>
    expectTypeOf<InferHandlerResponse<Handler>>().toEqualTypeOf<PaginatedResponse<unknown>>()
  })

  it('carries the row type through pagination', async () => {
    const handler = async (ctx: RequestContext) =>
      ctx.paginate(async () => ({ data: [] as User[], total: 0 }))
    expectTypeOf<InferHandlerResponse<typeof handler>>().toEqualTypeOf<PaginatedResponse<User>>()
    // `meta` is part of the contract the docs advertise.
    expectTypeOf<InferHandlerResponse<typeof handler>['meta']>().toHaveProperty('totalPages')
  })

  it('degrades an imperative ctx.json to unknown', () => {
    // Not `RuntimeResponse`: the engine object says nothing about the body,
    // and leaking it gave clients response-object methods instead of a
    // payload. To carry a type, return the value or wrap it with `reply`.
    const handler = (ctx: RequestContext) => ctx.json({ id: 'u1', name: 'a' } satisfies User)
    expectTypeOf<InferHandlerResponse<typeof handler>>().toEqualTypeOf<unknown>()
  })

  it('still prefers an explicitly returned payload', () => {
    const handler = (_ctx: RequestContext): User => ({ id: 'u1', name: 'a' })
    expectTypeOf<InferHandlerResponse<typeof handler>>().toEqualTypeOf<User>()
  })
})
