import { describe, it, expect, vi } from 'vitest'

import {
  defineDevtoolsRenderTab,
  type KickEventBus,
  type TabProps,
} from '../src'

const fakeBus = (): KickEventBus => {
  const handlers = new Map<string, Set<(p: unknown) => void>>()
  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return () => set.delete(handler)
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler)
    },
    emit(event, payload) {
      handlers.get(event)?.forEach((h) => h(payload))
    },
  }
}

const fakeProps = (overrides: Partial<TabProps> = {}): TabProps => ({
  bus: overrides.bus ?? fakeBus(),
  config: overrides.config ?? { theme: 'dark', panelHeight: 400 },
  query: overrides.query ?? new URLSearchParams(),
})

describe('defineDevtoolsRenderTab', () => {
  it('preserves the spec shape (identity factory)', () => {
    const tab = defineDevtoolsRenderTab({
      id: 'demo',
      name: 'Demo',
      render() {},
    })
    expect(tab.id).toBe('demo')
    expect(tab.name).toBe('Demo')
    expect(typeof tab.render).toBe('function')
  })

  it('render() receives the element + props', () => {
    const seen: { el?: object; bus?: KickEventBus } = {}
    const tab = defineDevtoolsRenderTab({
      id: 'demo',
      name: 'Demo',
      render(el, props) {
        seen.el = el
        seen.bus = props.bus
      },
    })
    const el = { fake: true } as unknown as HTMLElement
    const props = fakeProps()
    tab.render(el, props)
    expect(seen.el).toBe(el)
    expect(seen.bus).toBe(props.bus)
  })

  it('cleanup function returned from render() is callable', () => {
    const cleanup = vi.fn()
    const tab = defineDevtoolsRenderTab({
      id: 'demo',
      name: 'Demo',
      render() {
        return cleanup
      },
    })
    const teardown = tab.render({} as HTMLElement, fakeProps())
    expect(typeof teardown).toBe('function')
    if (typeof teardown === 'function') teardown()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('bus subscription pattern — handler fires on emit, unsubscribe stops it', () => {
    const bus = fakeBus()
    const handler = vi.fn()
    const off = bus.on('demo:event', handler)
    bus.emit?.('demo:event', { hello: 'world' })
    expect(handler).toHaveBeenCalledWith({ hello: 'world' })
    off()
    bus.emit?.('demo:event', { ignored: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('legacy defineDevtoolsTab + descriptor surface still exports', async () => {
    const mod = await import('../src')
    expect(typeof mod.defineDevtoolsTab).toBe('function')
    expect(typeof mod.defineDevtoolsRenderTab).toBe('function')
    // Two distinct functions — additive coexistence.
    expect(mod.defineDevtoolsTab).not.toBe(mod.defineDevtoolsRenderTab)
  })
})
