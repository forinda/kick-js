import 'reflect-metadata'
import { beforeEach, expect, it } from 'vitest'
import { Application, Container } from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'

beforeEach(() => {
  Container.reset()
})

it('closes the Fastify instance on shutdown, so its onClose hooks run', async () => {
  const app = new Application({ runtime: fastifyRuntime(), modules: [] })
  await app.setup()
  const fastify = (app as unknown as { app: { addHook(n: string, f: () => void): void } }).app
  let closed = false
  fastify.addHook('onClose', () => {
    closed = true
  })

  await app.shutdown({ closeServer: false })
  expect(closed).toBe(true)
})
