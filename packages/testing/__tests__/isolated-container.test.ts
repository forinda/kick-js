/**
 * #608: `Container.create()` seeded nothing, so an isolated container was
 * missing every class its decorators had registered — and `isolated: true`
 * is what the generated project docs recommend for test isolation.
 *
 * @module @forinda/kickjs-testing/__tests__/isolated-container.test
 */
import { describe, it, expect } from 'vitest'
import { Service, Controller, Get, defineModule, Container } from '@forinda/kickjs'
import { createTestApp } from '../src'

@Service()
class PricingService {
  quote(): number {
    return 42
  }
}

@Controller()
class PingController {
  @Get('/')
  ping(ctx: any) {
    return ctx.json({ ok: true })
  }
}

const PingModule = defineModule({
  name: 'PingModule',
  build: () => ({
    routes() {
      return { path: '/ping', controller: PingController, version: false, prefix: false }
    },
  }),
})

describe('isolated test containers', () => {
  it('resolves a decorator-registered service', async () => {
    const { container } = await createTestApp({ modules: [PingModule()], isolated: true })
    expect(container.resolve(PricingService).quote()).toBe(42)
  })

  it('matches what the shared container resolves', async () => {
    const shared = await createTestApp({ modules: [PingModule()] })
    const isolated = await createTestApp({ modules: [PingModule()], isolated: true })
    expect(isolated.container.resolve(PricingService).quote()).toBe(
      shared.container.resolve(PricingService).quote(),
    )
  })

  // The inverse leak: an isolated container used to write its registrations
  // into the persistent store, which `Container.reset()` replays — so an
  // override from one isolated test reappeared in every later test.
  it('does not leak an override into the global container via reset()', async () => {
    const TOKEN = 'test/only/in/isolated'
    await createTestApp({
      modules: [PingModule()],
      isolated: true,
      overrides: [[TOKEN, { from: 'isolated' }]],
    })

    Container.reset()
    expect(Container.getInstance().has(TOKEN)).toBe(false)
  })

  it('does not leak a resolved factory instance either', async () => {
    const isolated = Container.create()
    isolated.registerFactory('test/isolated/factory', () => ({ v: 1 }))
    isolated.resolve('test/isolated/factory')

    Container.reset()
    expect(Container.getInstance().has('test/isolated/factory')).toBe(false)
  })

  // Seeding must not turn the isolated container into the global one — that
  // would trade a missing-provider bug for a cross-test-contamination bug.
  it('stays a separate instance from the global container', async () => {
    const { container } = await createTestApp({ modules: [PingModule()], isolated: true })
    expect(container).not.toBe(Container.getInstance())

    container.registerInstance('only/in/isolated', { v: 1 })
    expect(container.has('only/in/isolated')).toBe(true)
    expect(Container.getInstance().has('only/in/isolated')).toBe(false)
  })
})
