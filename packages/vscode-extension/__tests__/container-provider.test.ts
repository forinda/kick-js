import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ContainerTreeProvider } from '../src/providers/container'

describe('ContainerTreeProvider', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns "No registrations" when empty', () => {
    const provider = new ContainerTreeProvider('http://localhost/_debug')
    const children = provider.getChildren()
    expect(children).toHaveLength(1)
    expect((children[0] as any).label).toBe('No registrations')
  })

  it('displays registrations with scope and instantiation status', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        registrations: [
          { token: 'UserService', scope: 'singleton', instantiated: true },
          { token: 'MailerService', scope: 'transient', instantiated: false },
          { token: 'AuthGuard', scope: 'request', instantiated: false },
        ],
      }),
    })

    const provider = new ContainerTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    const children = provider.getChildren()
    expect(children).toHaveLength(3)

    expect((children[0] as any).label).toBe('UserService')
    expect((children[0] as any).description).toBe('singleton (active)')
    expect((children[0] as any).iconPath.id).toBe('symbol-class')

    expect((children[1] as any).label).toBe('MailerService')
    expect((children[1] as any).description).toBe('transient ')
    expect((children[1] as any).iconPath.id).toBe('symbol-interface')
  })

  it('handles fetch failure gracefully', async () => {
    ;(globalThis.fetch as any).mockRejectedValueOnce(new Error('Network error'))

    const provider = new ContainerTreeProvider('http://localhost/_debug')
    provider.refresh()
    await new Promise((r) => setTimeout(r, 10))

    const children = provider.getChildren()
    expect(children).toHaveLength(1)
    expect((children[0] as any).label).toBe('No registrations')
  })
})
