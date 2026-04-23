import { describe, it, expect } from 'vitest'
import { RequestContext } from '../src/http/context'
import { requestStore } from '../src/http/request-store'

/**
 * Build a RequestContext + run the assertion inside a `requestStore.run`
 * frame so `ctx.set` writes succeed. Outside an ALS frame, writes throw
 * by design — see `metadataForWrite()` in src/http/context.ts.
 */
function withCtx<T>(
  overrides: { user?: any; meta?: Record<string, any> } = {},
  fn: (ctx: RequestContext) => T,
): T {
  const req: any = {
    body: {},
    params: {},
    query: {},
    headers: {},
  }
  if (overrides.user !== undefined) req.user = overrides.user
  const res: any = {}
  const next: any = () => {}

  const store = { requestId: 'r-test', instances: new Map(), values: new Map() }
  return requestStore.run(store, () => {
    const ctx = new RequestContext(req, res, next)
    if (overrides.meta) {
      for (const [key, value] of Object.entries(overrides.meta)) ctx.set(key, value)
    }
    return fn(ctx)
  })
}

describe('RequestContext.user', () => {
  it('returns undefined when no user is set', () => {
    withCtx({}, (ctx) => expect(ctx.user).toBeUndefined())
  })

  it('returns user from req.user (set by AuthAdapter)', () => {
    const user = { id: '1', email: 'test@test.com', roles: ['user'] }
    withCtx({ user }, (ctx) => expect(ctx.user).toEqual(user))
  })

  it('returns user from metadata store (set via ctx.set)', () => {
    const user = { id: '2', email: 'meta@test.com', roles: ['admin'] }
    withCtx({ meta: { user } }, (ctx) => expect(ctx.user).toEqual(user))
  })

  it('metadata store takes precedence over req.user', () => {
    const reqUser = { id: '1', source: 'req' }
    const metaUser = { id: '2', source: 'meta' }
    withCtx({ user: reqUser, meta: { user: metaUser } }, (ctx) =>
      expect(ctx.user).toEqual(metaUser),
    )
  })

  it('falls back to req.user when metadata has no user', () => {
    const reqUser = { id: '1', email: 'fallback@test.com' }
    withCtx({ user: reqUser, meta: { other: 'data' } }, (ctx) =>
      expect(ctx.user).toEqual(reqUser),
    )
  })

  it('ctx.get<T>("user") still works for backwards compatibility', () => {
    const user = { id: '1', roles: ['user'] }
    withCtx({ meta: { user } }, (ctx) => expect(ctx.get('user')).toEqual(user))
  })
})

describe('RequestContext.tenantId / .roles', () => {
  it('tenantId is undefined when no user is set', () => {
    withCtx({}, (ctx) => {
      expect(ctx.tenantId).toBeUndefined()
      expect(ctx.roles).toEqual([])
    })
  })

  it('tenantId reads user.tenantId', () => {
    withCtx({ user: { id: '1', tenantId: 't-9' } }, (ctx) => expect(ctx.tenantId).toBe('t-9'))
  })

  it('roles prefers user.tenantRoles over user.roles', () => {
    withCtx({ user: { id: '1', roles: ['user'], tenantRoles: ['owner', 'editor'] } }, (ctx) =>
      expect(ctx.roles).toEqual(['owner', 'editor']),
    )
  })

  it('roles falls back to user.roles when tenantRoles is missing', () => {
    withCtx({ user: { id: '1', roles: ['admin'] } }, (ctx) =>
      expect(ctx.roles).toEqual(['admin']),
    )
  })

  it('roles returns empty array when user has neither field', () => {
    withCtx({ user: { id: '1' } }, (ctx) => expect(ctx.roles).toEqual([]))
  })
})
