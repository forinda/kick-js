/**
 * Every shape a module entry legitimately arrives in.
 *
 * A `defineModule()` factory and a module class are both functions, so
 * `typeof` cannot tell them apart. Passing the factory uninvoked used to reach
 * `new factory()` and die with a bare `TypeError: entry is not a constructor`,
 * naming neither the offending module nor the fix.
 *
 * It is easy to hit because the class form takes the bare name, so the two
 * styles read as interchangeable — and the scaffolded test guidance showed the
 * class form even in projects the generator emits as `define`.
 *
 * @module @forinda/kickjs/__tests__/module-entry-forms.test
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, defineModule, type AppModule } from '../src/index'

const Core = defineModule({
  name: 'CoreModule',
  build: () => ({ routes: () => null }),
})

class LegacyModule implements AppModule {
  routes() {
    return null
  }
}

async function boot(modules: unknown[]) {
  const app = new Application({ modules: modules as never })
  await Promise.resolve(app.setup())
  return app
}

beforeEach(() => Container.reset())

describe('module entry forms', () => {
  it('accepts an invoked defineModule factory', async () => {
    await expect(boot([Core()])).resolves.toBeDefined()
  })

  it('accepts an UNINVOKED defineModule factory', async () => {
    // Calling it with no arguments produces exactly what `Core()` would, so
    // accepting this is equivalent rather than lenient.
    await expect(boot([Core])).resolves.toBeDefined()
  })

  it('accepts a legacy module class', async () => {
    await expect(boot([LegacyModule])).resolves.toBeDefined()
  })

  it('names the entry when a function is neither', async () => {
    // The bare `entry is not a constructor` said nothing about which module or
    // what to do; anything that replaces it has to say both.
    // An arrow function: not constructible, and without `definition` it is not
    // a defineModule factory either. A plain `function` would construct fine
    // and fail later on a missing method, which is a different message.
    const NotAModule = () => ({})
    await expect(boot([NotAModule])).rejects.toThrow(/NotAModule/)
    await expect(boot([NotAModule])).rejects.toThrow(/defineModule\(\) factory/)
  })
})
