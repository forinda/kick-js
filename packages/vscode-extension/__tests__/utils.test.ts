import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchDebugData } from '../src/utils'

describe('fetchDebugData', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns parsed JSON on success', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'healthy', uptime: 42 }),
    })

    const data = await fetchDebugData('http://localhost:3000/_debug', '/health')
    expect(data).toEqual({ status: 'healthy', uptime: 42 })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/_debug/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('returns null on non-ok response', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 404 })

    const data = await fetchDebugData('http://localhost:3000/_debug', '/health')
    expect(data).toBeNull()
  })

  it('returns null on network error', async () => {
    ;(globalThis.fetch as any).mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const data = await fetchDebugData('http://localhost:3000/_debug', '/routes')
    expect(data).toBeNull()
  })
})
