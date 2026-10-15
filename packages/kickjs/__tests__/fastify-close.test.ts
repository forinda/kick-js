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

it('answers 500 when Fastify fails to start and no host takes the error', async () => {
  const runtime = fastifyRuntime()
  const fastify = runtime.createApp({} as never) as { ready(): Promise<void> }
  fastify.ready = () => Promise.reject(new Error('plugin failed'))
  const handle = runtime.nodeHandler(fastify as never)
  const res = await new Promise<{ statusCode: number; body: string }>((resolve) => {
    const out = {
      statusCode: 200,
      end: (body: string) => resolve({ statusCode: out.statusCode, body }),
    }
    handle({ url: '/', method: 'GET', headers: {} } as never, out as never)
  })
  expect(res).toEqual({ statusCode: 500, body: 'Internal Server Error' })
})
