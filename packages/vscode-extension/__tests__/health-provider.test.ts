import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HealthTreeProvider } from '../src/providers/health'

describe('HealthTreeProvider', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('shows disconnected state initially', () => {
    const provider = new HealthTreeProvider('http://localhost/_debug')
    const children = provider.getChildren()
    expect(children).toHaveLength(1)
    expect((children[0] as any).label).toBe('Disconnected — check server URL')
  })

  it('shows health data after refresh', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'healthy',
        uptime: 120,
        errorRate: 0.02,
        adapters: { AuthAdapter: 'running', DevToolsAdapter: 'running' },
      }),
    })

    const provider = new HealthTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    expect(provider.isConnected()).toBe(true)

    const children = provider.getChildren()
    expect(children.length).toBeGreaterThanOrEqual(3)
    expect((children[0] as any).label).toBe('Status: healthy')
    expect((children[1] as any).label).toBe('Uptime: 120s')
    expect((children[2] as any).label).toContain('Error Rate')
    // Adapter items
    expect((children[3] as any).label).toBe('AuthAdapter: running')
  })

  it('reports disconnected on fetch failure', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 500 })

    const provider = new HealthTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    expect(provider.isConnected()).toBe(false)

    const children = provider.getChildren()
    expect((children[0] as any).label).toBe('Disconnected — check server URL')
  })

  it('updates status bar on health change', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'healthy', uptime: 60 }),
    })

    const provider = new HealthTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    expect(provider.statusBarItem.text).toContain('Healthy')
  })

  it('creates a disposable status bar item', () => {
    const provider = new HealthTreeProvider('http://localhost/_debug')
    expect(provider.statusBarItem).toBeDefined()
    expect(provider.statusBarItem.show).toHaveBeenCalled()
    provider.dispose()
    expect(provider.statusBarItem.dispose).toHaveBeenCalled()
  })

  it('routes status bar to kickjs.connect when disconnected', () => {
    const provider = new HealthTreeProvider('http://localhost/_debug')
    expect(provider.statusBarItem.command).toBe('kickjs.connect')
    expect(provider.statusBarItem.tooltip).toContain('Click to connect')
  })

  it('routes status bar to kickjs.inspect once connected', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'healthy', uptime: 60 }),
    })

    const provider = new HealthTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    expect(provider.statusBarItem.command).toBe('kickjs.inspect')
    expect(provider.statusBarItem.tooltip).toContain('Click to open dashboard')
  })
})
