/** `Application.status`: the lifecycle as a reactive value a watcher can follow. */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Container, watch, type AppStatus } from '../src/index'
import { Application } from '../src/http/application'
import { h3Runtime } from '../src/http/runtimes/h3'

describe('Application.status', () => {
  it('moves idle → starting → ready → draining → stopped, and a watcher sees each step', async () => {
    Container.reset()
    const app = new Application({ modules: [], runtime: h3Runtime(), port: 0 })
    expect(app.status.value).toBe('idle')
    const seen: AppStatus[] = []
    const stop = watch(app.status, (status) => seen.push(status))

    await app.start()
    expect(app.status.value).toBe('ready')
    expect(app.isDraining).toBe(false)

    await app.shutdown()
    expect(app.status.value).toBe('stopped')
    expect(app.isDraining).toBe(true)
    expect(seen).toEqual(['starting', 'ready', 'draining', 'stopped'])
    stop()
  })

  it('reaches ready without a server, and stays idle when only set up', async () => {
    Container.reset()
    const handler = new Application({ modules: [], runtime: h3Runtime() })
    await handler.startWithoutServer()
    expect(handler.status.value).toBe('ready')

    Container.reset()
    const setupOnly = new Application({ modules: [], runtime: h3Runtime() })
    await setupOnly.setup()
    expect(setupOnly.status.value).toBe('idle')
    const ready = await setupOnly.fetch(new Request('http://x/health/ready'))
    expect(ready.status).toBe(200)
  })
})
