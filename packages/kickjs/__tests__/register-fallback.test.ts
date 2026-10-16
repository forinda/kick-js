import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  KickError,
  createToken,
  type AppAdapter,
  type AppModule,
} from '../src/index'

interface Mailer {
  name: string
}
// A fresh token per test: `registerFactory` on the global container is kept
// across `Container.reset()` (the HMR persistence store), so one test's module
// binding would otherwise still be there in the next.
let MAILER = createToken<Mailer>('test/fallback/mailer')
let n = 0

beforeEach(() => {
  Container.reset()
  MAILER = createToken<Mailer>(`test/fallback/mailer-${++n}`)
})

/** An adapter that provides a default mailer unless the app binds its own. */
const mailerAdapter = (resolveEarly = false): AppAdapter => ({
  name: 'MailerAdapter',
  beforeMount({ container }) {
    container.registerFallback(MAILER, () => ({ name: 'console' }))
    if (resolveEarly) container.resolve(MAILER)
  },
})

const mailerModule = (): AppModule =>
  ({
    register(container) {
      container.registerFactory(MAILER, () => ({ name: 'smtp' }))
    },
    routes: () => [],
  }) as AppModule

describe('registerFallback across the boot order', () => {
  it('a module binding made after the adapter fallback wins', async () => {
    const app = new Application({ modules: [mailerModule()], adapters: [mailerAdapter()] })
    await app.setup()
    expect(app.getContainer().resolve(MAILER).name).toBe('smtp')
  })

  it('the adapter fallback serves when no module binds the token', async () => {
    const app = new Application({ modules: [], adapters: [mailerAdapter()] })
    await app.setup()
    const container = app.getContainer()
    expect(container.has(MAILER)).toBe(false)
    expect(container.resolve(MAILER).name).toBe('console')
  })

  it('a module binding after the fallback was resolved fails boot with KICK010', async () => {
    const app = new Application({ modules: [mailerModule()], adapters: [mailerAdapter(true)] })
    const err = await app.setup().then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(KickError)
    expect(err).toMatchObject({ code: 'KICK010' })
    expect((err as Error).message).toContain('test/fallback/mailer')
  })
})
