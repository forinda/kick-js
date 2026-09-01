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
