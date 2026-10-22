import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

/** The Content-Security-Policy the docs routes send. */
function csp(options: Partial<Parameters<typeof SwaggerAdapter>[0]> = {}): string {
  const adapter = SwaggerAdapter({ info: { title: 'T', version: '1' }, ...options })
  const http = { use: vi.fn(), route: vi.fn(), serveStatic: vi.fn() }
  adapter.beforeMount?.({ http } as any)
  const res = { setHeader: vi.fn() }
  http.use.mock.calls[0]![0]({}, res, () => {})
  return res.setHeader.mock.calls.find(([h]) => h === 'Content-Security-Policy')![1]
}

describe('docs CSP', () => {
  it('lets the default ReDoc load from jsDelivr and start its search worker', () => {
    const policy = csp()
    expect(policy).toMatch(/script-src [^;]*https:\/\/cdn\.jsdelivr\.net/)
    expect(policy).not.toContain('cdn.redoc.ly')
    expect(policy).toContain("worker-src 'self' blob:")
  })

  it('a custom ReDoc renderer gets no ReDoc allowances', () => {
    const policy = csp({ renderReDoc: () => '' })
    expect(policy).not.toContain('worker-src')
  })
})
