import { describe, it, expect, vi } from 'vitest'
import { InertiaAdapter } from '../src/inertia-adapter'
import type { InertiaConfig } from '../src/types'

function createConfig(overrides: Partial<InertiaConfig> = {}): InertiaConfig {
  return {
    rootView: '<html></html>',
    version: () => 'v1',
    ssr: { enabled: false },
    share: () => ({}),
    ...overrides,
  } as InertiaConfig
}

describe('InertiaAdapter', () => {
  it('has name "InertiaAdapter"', () => {
    const adapter = new InertiaAdapter(createConfig())
    expect(adapter.name).toBe('InertiaAdapter')
  })

  describe('middleware()', () => {
    it('returns a single middleware at beforeRoutes phase', () => {
      const adapter = new InertiaAdapter(createConfig())
      const middlewares = adapter.middleware!()

      expect(middlewares).toHaveLength(1)
      expect(middlewares[0].phase).toBe('beforeRoutes')
      expect(typeof middlewares[0].handler).toBe('function')
    })
  })

  describe('onHealthCheck()', () => {
    it('returns up status', async () => {
      const adapter = new InertiaAdapter(createConfig())
      const health = await adapter.onHealthCheck!()

      expect(health).toEqual({ name: 'InertiaAdapter', status: 'up' })
    })
  })

  describe('beforeMount()', () => {
    it('does not throw', async () => {
      const adapter = new InertiaAdapter(createConfig())
      const mockCtx = {
        app: {},
        container: { resolve: vi.fn() },
        env: 'development',
        isProduction: false,
      }

      expect(() => adapter.beforeMount!(mockCtx as any)).not.toThrow()
    })
  })
})
