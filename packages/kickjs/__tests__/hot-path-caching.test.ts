import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { registerAdapter } from '@forinda/kickjs-schema'
import { validate } from '../src/http/middleware/validate'
import { Application, Container, expressRuntime } from '../src/index'

describe('validate()', () => {
  it('detects the schema once, on the first request, so a later-registered adapter still applies', () => {
    const marker = { kind: 'custom-schema' }
    const detect = vi.fn((schema: unknown) => schema === marker)
    const mw = validate({ body: marker })
    // Registered after validate() was built — as a plugin may during boot.
    registerAdapter({
      name: 'test',
      detect,
      wrap: () => ({ safeParse: (data) => ({ success: true, data }), toJsonSchema: () => ({}) }),
    })

    const next = vi.fn()
    for (let i = 0; i < 3; i++) mw({ body: { a: i } } as never, {} as never, next)

    expect(next).toHaveBeenCalledTimes(3)
    expect(next).toHaveBeenLastCalledWith()
    expect(detect).toHaveBeenCalledTimes(1)
  })
})

describe('Application.handle()', () => {
  it('builds the engine handler once per engine app', async () => {
    Container.reset()
    const runtime = expressRuntime()
    const nodeHandler = vi.spyOn(runtime, 'nodeHandler')
    const app = new Application({ runtime, modules: [] })
    await app.setup()
    nodeHandler.mockClear()

    for (let i = 0; i < 3; i++) await app.fetch(new Request('http://x/api/v1/none'))
    expect(nodeHandler).toHaveBeenCalledTimes(1)
  })
})
