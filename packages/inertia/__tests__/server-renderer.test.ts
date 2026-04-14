import { describe, it, expect, vi, afterEach } from 'vitest'
import { ServerRenderer } from '../src/server-renderer'
import type { PageObject } from '../src/types'

const mockPageObject: PageObject = {
  component: 'Test/Page',
  props: { name: 'Alice' },
  url: '/test',
  version: 'v1',
  deferredProps: {},
  mergeProps: [],
}

describe('ServerRenderer', () => {
  afterEach(() => {
    delete (globalThis as any).__kickjs_viteServer
  })

  describe('when SSR is disabled', () => {
    it('returns null', async () => {
      const renderer = new ServerRenderer({ enabled: false })
      const result = await renderer.render(mockPageObject)
      expect(result).toBeNull()
    })
  })

  describe('when SSR is enabled but no Vite server and no bundle', () => {
    it('returns null (graceful fallback)', async () => {
      const renderer = new ServerRenderer({
        enabled: true,
        entrypoint: 'src/ssr.tsx',
      })
      const result = await renderer.render(mockPageObject)
      expect(result).toBeNull()
    })
  })

  describe('when SSR is enabled with a bundle path', () => {
    it('calls the bundle default export with pageObject', async () => {
      const mockRender = vi.fn().mockResolvedValue({
        head: ['<title>Test</title>'],
        body: '<div>SSR content</div>',
      })

      const renderer = new ServerRenderer({
        enabled: true,
        bundle: '/fake/ssr-bundle.js',
      })

      ;(renderer as any).loadProdBundle = vi.fn().mockResolvedValue({ default: mockRender })

      const result = await renderer.render(mockPageObject)

      expect(result).toEqual({
        head: ['<title>Test</title>'],
        body: '<div>SSR content</div>',
      })
    })
  })

  describe('when Vite server is available', () => {
    it('uses Vite runtime for SSR', async () => {
      const mockRender = vi.fn().mockResolvedValue({
        head: ['<title>Dev</title>'],
        body: '<div>Dev SSR</div>',
      })

      const mockRuntime = {
        import: vi.fn().mockResolvedValue({ default: mockRender }),
      }

      ;(globalThis as any).__kickjs_viteServer = {
        environments: { ssr: {} },
      }

      const renderer = new ServerRenderer({
        enabled: true,
        entrypoint: 'src/ssr.tsx',
      })

      ;(renderer as any).createRuntime = vi.fn().mockResolvedValue(mockRuntime)

      const result = await renderer.render(mockPageObject)

      expect(result).toEqual({
        head: ['<title>Dev</title>'],
        body: '<div>Dev SSR</div>',
      })
    })
  })
})
