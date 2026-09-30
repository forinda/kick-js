import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as vscode from 'vscode'
import {
  RoutesTreeProvider,
  formatFlags,
  openHandler,
  resolveSourcePath,
} from '../src/providers/routes'

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

  it('shows route flags in the description and tooltip', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        routes: [
          {
            method: 'GET',
            path: '/health',
            controller: 'HealthController',
            handler: 'live',
            flags: { 'auth.public': true, 'rate.limit': { rpm: 10 } },
          },
        ],
      }),
    })

    const provider = new RoutesTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    const [group] = provider.getChildren()
    const [route] = provider.getChildren(group as any) as any[]
    expect(route.description).toBe('live · auth.public, rate.limit={"rpm":10}')
    expect(route.tooltip).toContain('Flags: auth.public, rate.limit={"rpm":10}')
  })
})

describe('formatFlags', () => {
  it('returns empty for missing or empty flags (older devtools)', () => {
    expect(formatFlags(undefined)).toBe('')
    expect(formatFlags({})).toBe('')
  })
})

describe('open handler', () => {
  const found = {
    file: '/srv/app/src/users.controller.ts',
    relative: 'src/users.controller.ts',
    line: 12,
  }

  it('uses the absolute path when it exists, else the relative one under a workspace folder', () => {
    expect(resolveSourcePath(found, ['/ws'], (p) => p === found.file)).toBe(found.file)
    expect(
      resolveSourcePath(found, ['/a', '/ws'], (p) => p === '/ws/src/users.controller.ts'),
    ).toBe('/ws/src/users.controller.ts')
    expect(resolveSourcePath(found, ['/ws'], () => false)).toBeUndefined()
  })

  it('asks the devtools server and opens the file at the line', async () => {
    const originalFetch = globalThis.fetch
    const file = __filename
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...found, file }),
    }) as never
    try {
      await openHandler('http://localhost/_debug', 't0k', {
        controller: 'UsersController',
        handler: 'list',
      })
      const [url, init] = (globalThis.fetch as any).mock.calls[0]
      expect(url).toBe('http://localhost/_debug/source?controller=UsersController&handler=list')
      expect(init.headers).toEqual({ 'x-devtools-token': 't0k' })
      const [uri, options] = (vscode.window.showTextDocument as any).mock.calls[0]
      expect(uri.fsPath).toBe(file)
      expect(options.selection.start).toEqual({ line: 11, character: 0 })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('makes route items open their handler on click', async () => {
    const provider = new RoutesTreeProvider('http://localhost/_debug')
    ;(provider as any).routes = [
      { method: 'GET', path: '/u', controller: 'UsersController', handler: 'list' },
    ]
    const [group] = provider.getChildren()
    const [item] = provider.getChildren(group as any) as any[]
    expect(item.contextValue).toBe('kickjs.route')
    expect(item.command.command).toBe('kickjs.openHandler')
  })
})
