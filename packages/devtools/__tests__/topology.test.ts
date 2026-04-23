/**
 * E2E test for the topology aggregator + `/_debug/topology` endpoint.
 * Builds a fake Application surface that mirrors what `Application`
 * exposes via `__kickApp` (just the two methods the aggregator reads),
 * pairs it with a real Container, registers the three sample
 * adapters' introspect implementations, and asserts the snapshot shape
 * matches the kit's `TopologySnapshot` contract.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { Container, defineAdapter, type AppAdapter, type KickPlugin } from '@forinda/kickjs'
import { PROTOCOL_VERSION, type IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'
import { collectTopologySnapshot } from '../src/topology'

function fakeAppLike(adapters: AppAdapter[], plugins: KickPlugin[]) {
  return {
    getAdapters: () => adapters,
    getPlugins: () => plugins,
  }
}

describe('collectTopologySnapshot', () => {
  let container: Container

  beforeEach(() => {
    Container.reset()
    container = Container.getInstance()
  })

  it('returns the expected envelope shape', async () => {
    const snap = await collectTopologySnapshot({
      app: fakeAppLike([], []),
      container,
    })
    expect(snap.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(typeof snap.timestamp).toBe('number')
    expect(snap.plugins).toEqual([])
    expect(snap.adapters).toEqual([])
    expect(snap.contributors).toEqual([])
    expect(Array.isArray(snap.diTokens)).toBe(true)
    expect(snap.errors).toEqual([])
  })

  it('captures introspect() output from a real adapter', async () => {
    const Sample = defineAdapter({
      name: 'SampleAdapter',
      build: () => ({
        introspect: (): IntrospectionSnapshot => ({
          protocolVersion: PROTOCOL_VERSION,
          name: 'SampleAdapter',
          kind: 'adapter',
          metrics: { calls: 42 },
          tokens: { provides: ['kick/sample/Token'], requires: [] },
        }),
      }),
    })
    const snap = await collectTopologySnapshot({
      app: fakeAppLike([Sample()], []),
      container,
    })
    expect(snap.adapters).toHaveLength(1)
    expect(snap.adapters[0]).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      name: 'SampleAdapter',
      kind: 'adapter',
      metrics: { calls: 42 },
    })
    expect(snap.errors).toEqual([])
  })

  it('falls back to a stub for adapters without introspect()', async () => {
    const Plain = defineAdapter({
      name: 'PlainAdapter',
      build: () => ({ middleware: () => [] }),
    })
    const snap = await collectTopologySnapshot({
      app: fakeAppLike([Plain()], []),
      container,
    })
    expect(snap.adapters[0]).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      name: 'PlainAdapter',
      kind: 'adapter',
    })
  })

  it('collects an error entry when introspect() throws', async () => {
    const Broken = defineAdapter({
      name: 'BrokenAdapter',
      build: () => ({
        introspect: () => {
          throw new Error('boom')
        },
      }),
    })
    const snap = await collectTopologySnapshot({
      app: fakeAppLike([Broken()], []),
      container,
    })
    expect(snap.errors).toHaveLength(1)
    expect(snap.errors[0]).toMatchObject({
      name: 'BrokenAdapter',
      kind: 'adapter',
      message: 'boom',
    })
    // Stub still appears in the topology so the panel can render the row
    expect(snap.adapters[0]).toMatchObject({ name: 'BrokenAdapter', kind: 'adapter' })
  })

  it('times out and falls back to stub when introspect() hangs', async () => {
    const Hung = defineAdapter({
      name: 'HungAdapter',
      build: () => ({
        introspect: () => new Promise<IntrospectionSnapshot>(() => {}),
      }),
    })
    const snap = await collectTopologySnapshot({
      app: fakeAppLike([Hung()], []),
      container,
      introspectTimeoutMs: 20,
    })
    expect(snap.errors).toHaveLength(1)
    expect(snap.errors[0].message).toContain('timed out')
    expect(snap.adapters[0]).toMatchObject({ name: 'HungAdapter', kind: 'adapter' })
  })

  it('parallelises introspection across adapters', async () => {
    // Two slow adapters at 50ms each — wall-clock should be ~50ms,
    // not ~100ms, because they run concurrently.
    const Slow = (name: string) =>
      defineAdapter({
        name,
        build: () => ({
          introspect: async (): Promise<IntrospectionSnapshot> => {
            await new Promise((r) => setTimeout(r, 50))
            return { protocolVersion: PROTOCOL_VERSION, name, kind: 'adapter' }
          },
        }),
      })
    const start = Date.now()
    await collectTopologySnapshot({
      app: fakeAppLike([Slow('A')(), Slow('B')(), Slow('C')()], []),
      container,
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(150) // would be ~150ms if serial
  })

  it('drops __hmr__ tokens from the diTokens list', async () => {
    container.registerInstance('regular', { hello: 1 })
    container.registerInstance('__hmr__internal', { hello: 2 })
    const snap = await collectTopologySnapshot({
      app: fakeAppLike([], []),
      container,
    })
    const tokenStrings = snap.diTokens.map((t) => t.token)
    expect(tokenStrings).toContain('regular')
    expect(tokenStrings).not.toContain('__hmr__internal')
  })

  it('handles plugins with introspect()', async () => {
    const FlagsPlugin: KickPlugin = {
      name: 'FlagsPlugin',
      introspect: (): IntrospectionSnapshot => ({
        protocolVersion: PROTOCOL_VERSION,
        name: 'FlagsPlugin',
        kind: 'plugin',
        state: { enabled: true },
      }),
    }
    const snap = await collectTopologySnapshot({
      app: fakeAppLike([], [FlagsPlugin]),
      container,
    })
    expect(snap.plugins).toHaveLength(1)
    expect(snap.plugins[0]).toMatchObject({ name: 'FlagsPlugin', kind: 'plugin' })
    expect(snap.plugins[0].state).toEqual({ enabled: true })
  })
})
