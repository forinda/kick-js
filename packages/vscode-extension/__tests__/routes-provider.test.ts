import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RoutesTreeProvider } from '../src/providers/routes'

describe('RoutesTreeProvider', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns "No routes" when data is empty', () => {
    const provider = new RoutesTreeProvider('http://localhost/_debug')
    const children = provider.getChildren()
    expect(children).toHaveLength(1)
    expect((children[0] as any).label).toBe('No routes')
  })

  it('groups routes by controller', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        routes: [
          { method: 'GET', path: '/users', controller: 'UserController', handler: 'list' },
          { method: 'POST', path: '/users', controller: 'UserController', handler: 'create' },
          { method: 'GET', path: '/posts', controller: 'PostController', handler: 'list' },
        ],
      }),
    })

    const provider = new RoutesTreeProvider('http://localhost/_debug')
    provider.refresh()

    // Wait for async refresh
    await new Promise((r) => setTimeout(r, 10))

    // Root level should have 2 controller groups
    const groups = provider.getChildren()
    expect(groups).toHaveLength(2)

    // First group: UserController with 2 routes
    const userGroup = groups[0] as any
    expect(userGroup.controllerName).toBe('UserController')
    expect(userGroup.routes).toHaveLength(2)
    expect(userGroup.description).toBe('2 routes')

    // Second group: PostController with 1 route
    const postGroup = groups[1] as any
    expect(postGroup.controllerName).toBe('PostController')
    expect(postGroup.routes).toHaveLength(1)
    expect(postGroup.description).toBe('1 route')

    // Children of UserController group
    const userRoutes = provider.getChildren(userGroup)
    expect(userRoutes).toHaveLength(2)
    expect((userRoutes[0] as any).label).toBe('GET /users')
    expect((userRoutes[1] as any).label).toBe('POST /users')
  })

  it('shows route details in tooltip', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        routes: [
          {
            method: 'GET',
            path: '/users',
            controller: 'UserController',
            handler: 'list',
            middleware: ['auth', 'rateLimit'],
          },
        ],
      }),
    })

    const provider = new RoutesTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    const groups = provider.getChildren()
    const routes = provider.getChildren(groups[0] as any)
    const route = routes[0] as any
    expect(route.tooltip).toContain('GET /users')
    expect(route.tooltip).toContain('UserController')
    expect(route.tooltip).toContain('auth, rateLimit')
  })
})
