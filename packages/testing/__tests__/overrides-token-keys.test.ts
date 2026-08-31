/**
 * `overrides` has to accept a `createToken()` key.
 *
 * A token is a frozen OBJECT identified by reference, and TypeScript rejects an
 * object as a computed property key, so `{ [DATABASE]: fake }` did not compile
 * (`TS2464`). Tokens are the documented way to bind an interface to an
 * implementation — the generator emits one per repository — so the one key type
 * most worth overriding in a test was the one shape `overrides` could not take.
 *
 * The obvious workaround is worse than the error: `[TOKEN.name]` is a string,
 * it compiles, and the container keys tokens by reference — so the override is
 * silently never applied.
 *
 * @module @forinda/kickjs-testing/__tests__/overrides-token-keys.test
 */

import { describe, expect, it } from 'vitest'
import { createToken, Service } from '@forinda/kickjs'

import { createTestApp, createTestModule } from '../src/index'

interface Clock {
  now(): string
}
const CLOCK = createToken<Clock>('app/Clock/default')

@Service()
class RealClock implements Clock {
  now() {
    return 'real'
  }
}

const ClockModule = createTestModule({
  register: (c) => c.registerFactory(CLOCK, () => new RealClock()),
  routes: () => null,
})

const fake: Clock = { now: () => 'faked' }

describe('createTestApp overrides', () => {
  it('accepts a token via entries and actually rebinds it', async () => {
    const { container } = await createTestApp({
      modules: [ClockModule],
      overrides: [[CLOCK, fake]],
      isolated: true,
    })
    expect(container.resolve<Clock>(CLOCK).now()).toBe('faked')
  })

  it('accepts a Map for the same reason', async () => {
    const { container } = await createTestApp({
      modules: [ClockModule],
      overrides: new Map<unknown, unknown>([[CLOCK, fake]]),
      isolated: true,
    })
    expect(container.resolve<Clock>(CLOCK).now()).toBe('faked')
  })

  it('still accepts the object form for string and symbol keys', async () => {
    const STRING_KEY = 'app/legacy/clock'
    const Mod = createTestModule({
      register: (c) => c.registerFactory(STRING_KEY, () => new RealClock()),
      routes: () => null,
    })
    const { container } = await createTestApp({
      modules: [Mod],
      overrides: { [STRING_KEY]: fake },
      isolated: true,
    })
    expect(container.resolve<Clock>(STRING_KEY).now()).toBe('faked')
  })

  it('does NOT rebind when a token is passed by name — the silent-failure case', async () => {
    // Pinning the behaviour the docs now warn about: this compiles and looks
    // right, and the real binding survives untouched.
    const { container } = await createTestApp({
      modules: [ClockModule],
      overrides: { [CLOCK.name]: fake },
      isolated: true,
    })
    expect(container.resolve<Clock>(CLOCK).now()).toBe('real')
  })
})
