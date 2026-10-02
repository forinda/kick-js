/**
 * An adapter whose setup hook throws stops the app from booting — it didn't
 * finish wiring itself, and serving anyway runs on a half-built app (a
 * database adapter refusing pending migrations used to log and keep going).
 * `afterStart` runs once the server is listening, so its failure is logged.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, type AppAdapter } from '../src/index'

beforeEach(() => {
  Container.reset()
})

let app: Application | undefined
afterEach(async () => {
  await app?.shutdown()
  app = undefined
})

describe('adapter hook failures', () => {
  it('a beforeStart that throws rejects setup()', async () => {
    const adapter: AppAdapter = {
      name: 'Migrations',
      beforeStart() {
        throw new Error('2 pending migrations')
      },
    }
    app = new Application({ modules: [], adapters: [adapter] })
    await expect(app.setup()).rejects.toThrow('2 pending migrations')
  })

  it('an async beforeMount that rejects rejects setup()', async () => {
    const adapter: AppAdapter = {
      name: 'Broken',
      async beforeMount() {
        throw new Error('cannot connect')
      },
    }
    app = new Application({ modules: [], adapters: [adapter] })
    await expect(app.setup()).rejects.toThrow('cannot connect')
  })

  it('an afterStart that throws leaves the server running', async () => {
    const adapter: AppAdapter = {
      name: 'Banner',
      afterStart() {
        throw new Error('no terminal')
      },
    }
    app = new Application({ modules: [], adapters: [adapter], port: 0 })
    await expect(app.start()).resolves.toBeUndefined()
  })
})
