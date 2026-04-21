import { describe, it, expect } from 'vitest'
import { RequestContext } from '../src/http/context'

function mockCtx(overrides: { user?: any; meta?: Record<string, any> } = {}) {
  const req: any = {
    body: {},
    params: {},
    query: {},
    headers: {},
  }

  if (overrides.user !== undefined) {
    req.user = overrides.user
  }

  const res: any = {}
  const next: any = () => {}

  const ctx = new RequestContext(req, res, next)

  if (overrides.meta) {
    for (const [key, value] of Object.entries(overrides.meta)) {
      ctx.set(key, value)
    }
  }

  return ctx
}

describe('RequestContext.user', () => {
  it('returns undefined when no user is set', () => {
    const ctx = mockCtx()
    expect(ctx.user).toBeUndefined()
  })

  it('returns user from req.user (set by AuthAdapter)', () => {
    const user = { id: '1', email: 'test@test.com', roles: ['user'] }
    const ctx = mockCtx({ user })
    expect(ctx.user).toEqual(user)
  })

  it('returns user from metadata store (set via ctx.set)', () => {
    const user = { id: '2', email: 'meta@test.com', roles: ['admin'] }
    const ctx = mockCtx({ meta: { user } })
    expect(ctx.user).toEqual(user)
  })

  it('metadata store takes precedence over req.user', () => {
    const reqUser = { id: '1', source: 'req' }
    const metaUser = { id: '2', source: 'meta' }
    const ctx = mockCtx({ user: reqUser, meta: { user: metaUser } })
    expect(ctx.user).toEqual(metaUser)
  })

  it('falls back to req.user when metadata has no user', () => {
    const reqUser = { id: '1', email: 'fallback@test.com' }
    const ctx = mockCtx({ user: reqUser, meta: { other: 'data' } })
    expect(ctx.user).toEqual(reqUser)
  })

  it('ctx.get<T>("user") still works for backwards compatibility', () => {
    const user = { id: '1', roles: ['user'] }
    const ctx = mockCtx({ meta: { user } })
    expect(ctx.get('user')).toEqual(user)
  })
})

describe('RequestContext.tenantId / .roles', () => {
  it('tenantId is undefined when no user is set', () => {
    const ctx = mockCtx()
    expect(ctx.tenantId).toBeUndefined()
    expect(ctx.roles).toEqual([])
  })

  it('tenantId reads user.tenantId', () => {
    const ctx = mockCtx({ user: { id: '1', tenantId: 't-9' } })
    expect(ctx.tenantId).toBe('t-9')
  })

  it('roles prefers user.tenantRoles over user.roles', () => {
    const ctx = mockCtx({
      user: { id: '1', roles: ['user'], tenantRoles: ['owner', 'editor'] },
    })
    expect(ctx.roles).toEqual(['owner', 'editor'])
  })

  it('roles falls back to user.roles when tenantRoles is missing', () => {
    const ctx = mockCtx({ user: { id: '1', roles: ['admin'] } })
    expect(ctx.roles).toEqual(['admin'])
  })

  it('roles returns empty array when user has neither field', () => {
    const ctx = mockCtx({ user: { id: '1' } })
    expect(ctx.roles).toEqual([])
  })
})
