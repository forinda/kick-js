/**
 * The DevTools adapter publishes its bus process-wide while it runs, so a
 * kick/db client created at import time reports queries without wiring.
 */
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import { Application, Container } from '@forinda/kickjs'
import {
  DEVTOOLS_BUS,
  getActiveDevtoolsBus,
  setActiveDevtoolsBus,
} from '@forinda/kickjs-devtools-kit/bus/token'
import { DevToolsAdapter } from '../src/adapter'

afterEach(() => setActiveDevtoolsBus(undefined))

describe('DevToolsAdapter — process-wide bus', () => {
  it('is the registered bus while the app runs, and cleared on shutdown', async () => {
    Container.reset()
    const app = new Application({
      modules: [],
      adapters: [DevToolsAdapter({ enabled: true, secret: false, runtime: { enabled: false } })],
    })
    await app.setup()
    expect(getActiveDevtoolsBus()).toBeDefined()
    expect(getActiveDevtoolsBus()).toBe(Container.getInstance().resolve(DEVTOOLS_BUS))
    await app.shutdown()
    expect(getActiveDevtoolsBus()).toBeUndefined()
  })

  it('is not published when DevTools is disabled', async () => {
    Container.reset()
    const app = new Application({ modules: [], adapters: [DevToolsAdapter({ enabled: false })] })
    await app.setup()
    expect(getActiveDevtoolsBus()).toBeUndefined()
    await app.shutdown()
  })
})
