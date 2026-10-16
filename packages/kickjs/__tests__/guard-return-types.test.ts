/**
 * A guard stops the request by writing a response and not calling `next()`;
 * what it returns is ignored. So `return ctx.problem.unauthorized()` — the
 * idiom handlers use — must type-check in a guard passed to `@Middleware()`.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { Middleware, type MiddlewareHandler, type RequestContext } from '../src/index'

async function authGuard(ctx: RequestContext, next: () => void) {
  if (!ctx.headers.authorization) return ctx.problem.unauthorized()
  next()
}

describe('guard return types', () => {
  it('accepts a guard that returns the response helper', () => {
    expectTypeOf(authGuard).toExtend<MiddlewareHandler<RequestContext>>()
    expectTypeOf(Middleware(authGuard)).toBeFunction()
  })
})
