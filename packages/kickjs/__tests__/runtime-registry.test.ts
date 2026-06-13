import { describe, it, expect } from 'vitest'
import type { Express } from 'express'
import type { ActiveRuntime, ExpressRuntimeTypes } from '../src/index'

// Compile-time assertions: with no `KickRuntimeRegister` augmentation present,
// the active runtime resolves to the Express type map (spec §4.3b default).
// `pnpm typecheck` (tsgo) fails to compile these lines if the conditional type
// or its default ever regresses. The runtime `expect`s just give the assertions
// a home in the test runner.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const activeDefaultsToExpressTypes: Equal<ActiveRuntime, ExpressRuntimeTypes> = true
const activeAppIsExpress: Equal<ActiveRuntime['app'], Express> = true

describe('runtime registry (§4.3b)', () => {
  it('defaults ActiveRuntime to the Express type map when unaugmented', () => {
    expect(activeDefaultsToExpressTypes).toBe(true)
    expect(activeAppIsExpress).toBe(true)
  })
})
