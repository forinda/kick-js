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
import {
  Application,
  Container,
  defineModule,
  type AppModule,
  type AppModuleEntry,
} from '../src/index'

const Core = defineModule({
  name: 'CoreModule',
  build: () => ({ routes: () => null }),
})

class LegacyModule implements AppModule {
  routes() {
    return null
  }
}

async function boot(modules: AppModuleEntry[]) {
  const app = new Application({ modules })
  await Promise.resolve(app.setup())
  return app
}

beforeEach(() => Container.reset())

describe('module entry forms', () => {
  it('accepts an invoked defineModule factory', async () => {
    await expect(boot([Core()])).resolves.toBeDefined()
  })

  it('accepts an UNINVOKED factory when the module takes no config', async () => {
    // With nothing to configure, calling it with no arguments produces exactly
    // what `Core()` would — equivalent rather than lenient.
    await expect(boot([Core])).resolves.toBeDefined()
  })

  it('refuses an UNINVOKED factory when the module takes config', async () => {
    // Not equivalent in intent: the bare name silently selects the defaults, so
    // an author who meant `Tenant({ region })` gets an app wired the wrong way
    // with nothing said. Staying loud here is the point of the whole change.
    const Tenant = defineModule({
      name: 'TenantModule',
      defaults: { region: 'eu' },
      build: () => ({ routes: () => null }),
    })
    await expect(boot([Tenant])).rejects.toThrow(/TenantModule/)
    await expect(boot([Tenant])).rejects.toThrow(/must be invoked/)
    await expect(boot([Tenant])).rejects.toThrow(/silently selected the defaults/)
  })

  it('accepts that same configurable module once invoked, either way', async () => {
    const Tenant = defineModule({
      name: 'TenantModule',
      defaults: { region: 'eu' },
      build: () => ({ routes: () => null }),
    })
    await expect(boot([Tenant()])).resolves.toBeDefined()
    Container.reset()
    await expect(boot([Tenant({ region: 'us' })])).resolves.toBeDefined()
  })

  it('accepts a legacy module class', async () => {
    await expect(boot([LegacyModule])).resolves.toBeDefined()
  })

  it('surfaces a constructor error instead of blaming the module shape', async () => {
    // The first version wrapped `new entry()` in a catch that reported every
    // failure as "not a module class" — so a module whose constructor threw
    // sent the reader to the wrong place entirely, with the real error gone.
    class ExplodingModule implements AppModule {
      constructor() {
        throw new Error('DATABASE_URL is not set')
      }
      routes() {
        return null
      }
    }
    await expect(boot([ExplodingModule])).rejects.toThrow(/DATABASE_URL is not set/)
  })

  it('names an entry that constructs but is not a module', async () => {
    // `function Foo() {}` IS constructible and returns `{}`, so it used to slip
    // past the diagnostic and die later inside the framework at `mod.routes()`
    // — a generic error, far from the entry that caused it.
    function NotAModule() {}
    await expect(boot([NotAModule as unknown as AppModuleEntry])).rejects.toThrow(/NotAModule/)
    await expect(boot([NotAModule as unknown as AppModuleEntry])).rejects.toThrow(
      /does not implement AppModule/,
    )
  })

  it('names the entry when a function is neither', async () => {
    // The bare `entry is not a constructor` said nothing about which module or
    // what to do; anything that replaces it has to say both.
    // An arrow function: not constructible, and without `definition` it is not
    // a defineModule factory either. A plain `function` would construct fine
    // and fail later on a missing method, which is a different message.
    const NotAModule = () => ({})
    await expect(boot([NotAModule as unknown as AppModuleEntry])).rejects.toThrow(/NotAModule/)
    await expect(boot([NotAModule as unknown as AppModuleEntry])).rejects.toThrow(
      /defineModule\(\) factory/,
    )
  })
})
