import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { createAuthStrategy, type CreateAuthStrategyOptions } from '@forinda/kickjs-auth'

interface ApiKeyTestOptions {
  keys: Record<string, { name: string; roles?: string[] }>
  headerName?: string
}

const baseOptions = (): CreateAuthStrategyOptions<ApiKeyTestOptions> => ({
  name: 'api-key',
  defaults: { headerName: 'x-api-key' },
  build: (options, ctx) => ({
    validate(req: any) {
      const key = req.headers?.[options.headerName!]
      const user = key ? options.keys[key] : null
      // Stash ctx for assertions
      ;(req as Record<string, unknown>).__ctx = ctx
      return user ?? null
    },
  }),
})

describe('createAuthStrategy — bare call', () => {
  it('returns an AuthStrategy with the documented name', () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const strategy = ApiKey({ keys: { 'sk-1': { name: 'CI' } } })
    expect(strategy.name).toBe('api-key')
    expect(typeof strategy.validate).toBe('function')
  })

  it('merges defaults under caller overrides', async () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const strategy = ApiKey({ keys: { 'sk-1': { name: 'CI' } } })
    const req = { headers: { 'x-api-key': 'sk-1' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ name: 'CI' })
  })

  it('caller can override a default field', async () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const strategy = ApiKey({
      keys: { 'sk-1': { name: 'CI' } },
      headerName: 'x-custom-key',
    })
    const req = { headers: { 'x-custom-key': 'sk-1' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ name: 'CI' })
  })

  it('returns null when no key present', async () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const strategy = ApiKey({ keys: { 'sk-1': { name: 'CI' } } })
    const req = { headers: {} }
    const user = await strategy.validate(req)
    expect(user).toBeNull()
  })

  it('passes BuildContext with name + scoped=false', async () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const strategy = ApiKey({ keys: { 'sk-1': { name: 'CI' } } })
    const req = { headers: { 'x-api-key': 'sk-1' } } as Record<string, unknown>
    await strategy.validate(req as any)
    expect(req.__ctx).toEqual({ name: 'api-key', scoped: false })
  })
})

describe('createAuthStrategy — .scoped()', () => {
  it('namespaces the instance name as `${defName}:${scope}`', () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const admin = ApiKey.scoped('admin', { keys: { 'sk-admin': { name: 'Admin' } } })
    const publicScope = ApiKey.scoped('public', { keys: { 'sk-pub': { name: 'Public' } } })
    expect(admin.name).toBe('api-key:admin')
    expect(publicScope.name).toBe('api-key:public')
  })

  it('passes BuildContext with scoped=true and the composed name', async () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const strategy = ApiKey.scoped('admin', { keys: { 'sk-1': { name: 'X' } } })
    const req = { headers: { 'x-api-key': 'sk-1' } } as Record<string, unknown>
    await strategy.validate(req as any)
    expect(req.__ctx).toEqual({ name: 'api-key:admin', scoped: true })
  })

  it('produces independent strategies per scope (no shared state)', async () => {
    const ApiKey = createAuthStrategy(baseOptions())
    const admin = ApiKey.scoped('admin', { keys: { 'admin-key': { name: 'Admin' } } })
    const publicScope = ApiKey.scoped('public', { keys: { 'pub-key': { name: 'Public' } } })

    const adminUser = await admin.validate({ headers: { 'x-api-key': 'admin-key' } })
    const publicUser = await publicScope.validate({ headers: { 'x-api-key': 'pub-key' } })
    const crossUser = await admin.validate({ headers: { 'x-api-key': 'pub-key' } })

    expect(adminUser).toEqual({ name: 'Admin' })
    expect(publicUser).toEqual({ name: 'Public' })
    expect(crossUser).toBeNull()
  })
})

describe('createAuthStrategy — definition metadata', () => {
  it('exposes a frozen `definition` for tooling', () => {
    const ApiKey = createAuthStrategy(baseOptions())
    expect(ApiKey.definition.name).toBe('api-key')
    expect(Object.isFrozen(ApiKey.definition)).toBe(true)
  })
})
