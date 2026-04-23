/**
 * Type-level + smoke tests for the optional `introspect()` slot added to
 * `defineAdapter()` and `definePlugin()` in @forinda/kickjs. Verifies
 * the slot accepts both sync and async returns, accepts a typed
 * `IntrospectionSnapshot`, and is fully back-compat (omitting it still
 * compiles + the factory still produces a valid AppAdapter / KickPlugin).
 */

import { describe, it, expect } from 'vitest'
import { defineAdapter, definePlugin } from '@forinda/kickjs'
import { PROTOCOL_VERSION, type IntrospectionSnapshot } from '../src'

describe('defineAdapter — introspect slot', () => {
  it('accepts an adapter without introspect (back-compat)', () => {
    const Plain = defineAdapter({
      name: 'PlainAdapter',
      build: () => ({ middleware: () => [] }),
    })
    const instance = Plain()
    expect(instance.name).toBe('PlainAdapter')
    expect(instance.introspect).toBeUndefined()
  })

  it('accepts an adapter with a sync introspect()', () => {
    const Sync = defineAdapter({
      name: 'SyncAdapter',
      build: () => ({
        introspect: (): IntrospectionSnapshot => ({
          protocolVersion: PROTOCOL_VERSION,
          name: 'SyncAdapter',
          kind: 'adapter',
          metrics: { calls: 0 },
        }),
      }),
    })
    const instance = Sync()
    expect(typeof instance.introspect).toBe('function')
    const snap = instance.introspect!() as IntrospectionSnapshot
    expect(snap.name).toBe('SyncAdapter')
    expect(snap.metrics?.calls).toBe(0)
  })

  it('accepts an adapter with an async introspect()', async () => {
    const Async = defineAdapter({
      name: 'AsyncAdapter',
      build: () => ({
        introspect: async (): Promise<IntrospectionSnapshot> => ({
          protocolVersion: PROTOCOL_VERSION,
          name: 'AsyncAdapter',
          kind: 'adapter',
          state: { ready: true },
        }),
      }),
    })
    const instance = Async()
    const snap = (await instance.introspect!()) as IntrospectionSnapshot
    expect(snap.state?.ready).toBe(true)
  })
})

describe('definePlugin — introspect slot', () => {
  it('accepts a plugin without introspect (back-compat)', () => {
    const Plain = definePlugin({
      name: 'PlainPlugin',
      build: () => ({}),
    })
    const instance = Plain()
    expect(instance.name).toBe('PlainPlugin')
    expect(instance.introspect).toBeUndefined()
  })

  it('accepts a plugin with introspect()', () => {
    const WithSnap = definePlugin({
      name: 'FlagsPlugin',
      build: () => ({
        introspect: (): IntrospectionSnapshot => ({
          protocolVersion: PROTOCOL_VERSION,
          name: 'FlagsPlugin',
          kind: 'plugin',
          tokens: { provides: ['kick/flags/Provider'], requires: [] },
        }),
      }),
    })
    const instance = WithSnap()
    const snap = instance.introspect!() as IntrospectionSnapshot
    expect(snap.tokens?.provides).toContain('kick/flags/Provider')
  })
})
