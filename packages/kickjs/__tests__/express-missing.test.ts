/** With `express` not installed, only an app that runs on Express fails — and says why. */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { Container } from '../src/index'
import { Application } from '../src/http/application'
import { h3Runtime } from '../src/http/runtimes/h3'
import { expressRuntime } from '../src/http/runtimes/express-lazy'

// What the lazy runtime imports when it loads Express; failing it is `express` missing.
vi.mock('../src/http/runtimes/express', () => {
  throw new Error("Cannot find package 'express'")
})

describe('express not installed', () => {
  it('an app on another runtime starts, though something asked for Express', async () => {
    Container.reset()
    expressRuntime() // starts the load that will fail
    const app = new Application({ modules: [], runtime: h3Runtime() })
    await app.startWithoutServer()
    expect((await app.fetch(new Request('http://x/health/live'))).status).toBe(200)
  })

  it('an app on Express fails at setup, naming the package', async () => {
    Container.reset()
    const app = new Application({ modules: [] })
    await expect(app.startWithoutServer()).rejects.toThrow(/needs the 'express' package/)
  })

  it('fetch() before setup rejects instead of throwing', async () => {
    Container.reset()
    const app = new Application({ modules: [], runtime: h3Runtime() })
    await expect(app.fetch(new Request('http://x/'))).rejects.toThrow(/before setup/)
  })
})
