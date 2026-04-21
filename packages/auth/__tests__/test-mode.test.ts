import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { AuthAdapter, Can, Roles } from '@forinda/kickjs-auth'
import { Controller, Delete, Get } from '@forinda/kickjs'

describe('AuthAdapter.testMode()', () => {
  it('creates an adapter that always returns the given user', async () => {
    const testUser = { id: 'test-1', email: 'test@test.com', roles: ['admin'] }
    const adapter = AuthAdapter.testMode({ user: testUser, defaultPolicy: 'protected' })

    expect(adapter.name).toBe('AuthAdapter')

    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/test', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/test' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toEqual(testUser)
  })

  it('defaults to open policy', () => {
    const adapter = AuthAdapter.testMode({ user: { id: '1' } })
    const handler = adapter.middleware!()[0].handler

    // Open policy means unmatched routes pass through
    const req = { method: 'GET', path: '/unknown', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/unknown' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    handler(req, res, next)
    // With open policy and no route match, should pass through
    expect(next).toHaveBeenCalled()
  })

  it('supports custom defaultPolicy', async () => {
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      defaultPolicy: 'protected',
    })

    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/test', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/test' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    // Protected policy, test strategy always authenticates
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toEqual({ id: '1' })
  })

  it('populates user.tenantId when tenantId is provided', async () => {
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      tenantId: 't-42',
      defaultPolicy: 'protected',
    })
    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/x', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/x' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    await handler(req, res, vi.fn())
    expect((req as any).user.tenantId).toBe('t-42')
  })

  it('populates user.tenantRoles when roles + tenantId are provided', async () => {
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      tenantId: 't-1',
      roles: ['owner'],
      defaultPolicy: 'protected',
    })
    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/x', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/x' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    await handler(req, res, vi.fn())
    expect((req as any).user.tenantRoles).toEqual(['owner'])
  })

  it('populates user.roles when roles is provided without tenantId', async () => {
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      roles: ['admin'],
      defaultPolicy: 'protected',
    })
    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/x', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/x' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    await handler(req, res, vi.fn())
    expect((req as any).user.roles).toEqual(['admin'])
  })

  it('testMode roles satisfy @Roles() on handlers', async () => {
    @Controller()
    class AdminCtrl {
      @Get('/admin')
      @Roles('admin')
      index() {}
    }
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      roles: ['admin'],
      defaultPolicy: 'protected',
    })
    adapter.onRouteMount!(AdminCtrl, '/api')
    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'GET',
      path: '/api/admin',
      baseUrl: '',
      headers: {},
      ip: '1.1.1.1',
      url: '/api/admin',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()
    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('deny short-circuits @Can() without a @Policy class', async () => {
    @Controller()
    class FlockCtrl {
      @Delete('/flocks/:id')
      @Can('delete', 'flock')
      remove() {}
    }
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      defaultPolicy: 'protected',
      deny: ['flock.delete'],
    })
    adapter.onRouteMount!(FlockCtrl, '/api')
    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'DELETE',
      path: '/api/flocks/1',
      baseUrl: '',
      headers: {},
      ip: '1.1.1.1',
      url: '/api/flocks/1',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()
    await handler(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('allow short-circuits @Can() without a @Policy class', async () => {
    @Controller()
    class FlockViewCtrl {
      @Get('/flocks')
      @Can('view', 'flock')
      list() {}
    }
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      defaultPolicy: 'protected',
      allow: ['flock.view'],
    })
    adapter.onRouteMount!(FlockViewCtrl, '/api')
    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'GET',
      path: '/api/flocks',
      baseUrl: '',
      headers: {},
      ip: '1.1.1.1',
      url: '/api/flocks',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()
    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})
