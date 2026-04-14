import { describe, it, expect, beforeEach } from 'vitest'
import { Inertia } from '../src/inertia'
import { defer, optional, always, merge } from '../src/props'
import type { InertiaConfig } from '../src/types'

function makeMockCtx(overrides: {
  url?: string
  method?: string
  headers?: Record<string, string>
} = {}) {
  const jsonCalls: any[] = []
  const htmlCalls: any[] = []

  const ctx: any = {
    req: {
      url: overrides.url ?? '/test',
      method: overrides.method ?? 'GET',
      headers: overrides.headers ?? {},
    },
    res: {
      _status: 200,
      _headers: {} as Record<string, string>,
      status(code: number) {
        this._status = code
        return this
      },
      setHeader(key: string, value: string) {
        this._headers[key] = value
        return this
      },
      json(data: any) {
        jsonCalls.push(data)
      },
      end() {},
      send(body: string) {
        htmlCalls.push(body)
      },
    },
    _metadata: {} as Record<string, any>,
    get(key: string) {
      return this._metadata[key]
    },
    set(key: string, value: any) {
      this._metadata[key] = value
    },
    json(data: any) {
      jsonCalls.push(data)
    },
    html(content: string) {
      htmlCalls.push(content)
    },
    _jsonCalls: jsonCalls,
    _htmlCalls: htmlCalls,
  }

  return ctx
}

const baseConfig: InertiaConfig = {
  rootView: '<html><!-- {{INERTIA_PAGE}} --></html>',
  version: () => 'v1',
}

describe('Inertia', () => {
  describe('buildPageObject', () => {
    it('full page load builds PageObject with component, props, url, version', async () => {
      const ctx = makeMockCtx({ url: '/home' })
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Home/Index', { title: 'Hello' })

      expect(page.component).toBe('Home/Index')
      expect(page.props.title).toBe('Hello')
      expect(page.url).toBe('/home')
      expect(page.version).toBe('v1')
    })

    it('shared data merges under page props and page wins on conflict', async () => {
      const ctx = makeMockCtx()
      const config: InertiaConfig = {
        ...baseConfig,
        share: async () => ({ user: 'shared-user', extra: 'from-shared' }),
      }
      const inertia = new Inertia(ctx, config)
      const page = await inertia.buildPageObject('Page', { user: 'page-user' })

      expect(page.props.user).toBe('page-user')
      expect(page.props.extra).toBe('from-shared')
    })

    it('async props are awaited', async () => {
      const ctx = makeMockCtx()
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        data: Promise.resolve('async-value'),
      })

      expect(page.props.data).toBe('async-value')
    })

    it('deferred props are skipped on full load and groups collected in deferredProps', async () => {
      const ctx = makeMockCtx()
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        lazy: defer(() => 'deferred-value'),
        eager: 'eager-value',
      })

      expect(page.props.lazy).toBeUndefined()
      expect(page.props.eager).toBe('eager-value')
      expect(page.deferredProps['default']).toContain('lazy')
    })

    it('optional props are skipped on full load', async () => {
      const ctx = makeMockCtx()
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        opt: optional(() => 'optional-value'),
        normal: 'normal-value',
      })

      expect(page.props.opt).toBeUndefined()
      expect(page.props.normal).toBe('normal-value')
    })

    it('always() props are unwrapped and always included', async () => {
      const ctx = makeMockCtx()
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        flash: always({ message: 'success' }),
      })

      expect(page.props.flash).toEqual({ message: 'success' })
    })

    it('merge() props are unwrapped and field tracked in mergeProps', async () => {
      const ctx = makeMockCtx()
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        items: merge([1, 2, 3]),
      })

      expect(page.props.items).toEqual([1, 2, 3])
      expect(page.mergeProps).toContain('items')
    })

    it('deferred props grouped correctly with custom groups and default', async () => {
      const ctx = makeMockCtx()
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        a: defer(() => 'a', 'group1'),
        b: defer(() => 'b', 'group1'),
        c: defer(() => 'c'),
      })

      expect(page.deferredProps['group1']).toEqual(['a', 'b'])
      expect(page.deferredProps['default']).toEqual(['c'])
    })

    it('partial reload: filters to requested fields plus always fields', async () => {
      const ctx = makeMockCtx({
        headers: {
          'x-inertia': 'true',
          'x-inertia-partial-component': 'Page',
          'x-inertia-partial-data': 'name',
        },
      })
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        name: 'Alice',
        age: 30,
        flash: always('ok'),
      })

      expect(page.props.name).toBe('Alice')
      expect(page.props.age).toBeUndefined()
      expect(page.props.flash).toBe('ok')
    })

    it('partial reload: resolves deferred props when requested', async () => {
      const ctx = makeMockCtx({
        headers: {
          'x-inertia': 'true',
          'x-inertia-partial-component': 'Page',
          'x-inertia-partial-data': 'lazy',
        },
      })
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        lazy: defer(() => Promise.resolve('deferred-resolved')),
      })

      expect(page.props.lazy).toBe('deferred-resolved')
    })

    it('partial reload: resolves optional props when requested', async () => {
      const ctx = makeMockCtx({
        headers: {
          'x-inertia': 'true',
          'x-inertia-partial-component': 'Page',
          'x-inertia-partial-data': 'opt',
        },
      })
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        opt: optional(() => Promise.resolve('optional-resolved')),
      })

      expect(page.props.opt).toBe('optional-resolved')
    })

    it('non-matching partial component treated as full load', async () => {
      const ctx = makeMockCtx({
        headers: {
          'x-inertia': 'true',
          'x-inertia-partial-component': 'Other/Page',
          'x-inertia-partial-data': 'name',
        },
      })
      const inertia = new Inertia(ctx, baseConfig)
      const page = await inertia.buildPageObject('Page', {
        name: 'Alice',
        age: 30,
        lazy: defer(() => 'deferred'),
      })

      // Full load — all non-deferred props resolved, deferred skipped
      expect(page.props.name).toBe('Alice')
      expect(page.props.age).toBe(30)
      expect(page.props.lazy).toBeUndefined()
      expect(page.deferredProps['default']).toContain('lazy')
    })
  })

  describe('share()', () => {
    it('adds shared data and is chainable', async () => {
      const ctx = makeMockCtx()
      const inertia = new Inertia(ctx, baseConfig)
      const result = inertia.share({ extra: 'shared' })

      expect(result).toBe(inertia)

      const page = await inertia.buildPageObject('Page', {})
      expect(page.props.extra).toBe('shared')
    })
  })

  describe('getVersion()', () => {
    it('returns version from config function', () => {
      const ctx = makeMockCtx()
      const config: InertiaConfig = { rootView: '', version: () => 'abc123' }
      const inertia = new Inertia(ctx, config)
      expect(inertia.getVersion()).toBe('abc123')
    })

    it('returns dev when no version function is provided', () => {
      const ctx = makeMockCtx()
      const config: InertiaConfig = { rootView: '' }
      const inertia = new Inertia(ctx, config)
      expect(inertia.getVersion()).toBe('dev')
    })
  })
})
