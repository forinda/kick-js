/**
 * Integration test: boot a real test app, hit `HelloController` over
 * HTTP, and assert the response body contains the user-defined env
 * values that flow through `ConfigService` (which is `@Autowired()` on
 * the controller).
 *
 * This is the end-to-end version of `config-service.test.ts`: instead
 * of pulling `ConfigService` out of the container directly, we let the
 * full DI lifecycle wire it up via property injection on a controller,
 * then verify the response a real HTTP client would see.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { loadEnv } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'
import envSchema from '../../env'
import { HelloModule } from './hello.module'

describe('HelloController + injected ConfigService', () => {
  let server: http.Server
  let baseUrl: string

  beforeAll(async () => {
    // Pin the env BEFORE building the test app so the controller's
    // injected ConfigService sees the values we expect.
    process.env.APP_NAME = 'KickJS V3 Preview'
    process.env.APP_GREETING = 'Hello from .env'
    process.env.NODE_ENV = 'development'
    process.env.PORT = '3000'
    loadEnv(envSchema)

    const { expressApp } = await createTestApp({ modules: [HelloModule] })

    // Spin up a real HTTP server on a random port so we can fetch() it.
    server = http.createServer(expressApp)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  })

  it('GET / returns user env values pulled from ConfigService', async () => {
    const res = await fetch(`${baseUrl}/api/v1/hello`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      message: string
      greeting: string
      env: { port: number; nodeEnv: string; appName: string }
    }

    // The greet() helper interpolates APP_NAME into the message
    expect(body.message).toBe('Hello KickJS V3 Preview from KickJS!')
    // The user-defined APP_GREETING comes straight off ConfigService
    expect(body.greeting).toBe('Hello from .env')
    // Base + user keys via the typed `env` block
    expect(body.env.appName).toBe('KickJS V3 Preview')
    expect(body.env.nodeEnv).toBe('development')
    // PORT is z.coerce.number() — must be a real number, not a string
    expect(body.env.port).toBe(3000)
    expect(typeof body.env.port).toBe('number')
  })

  it('GET /health uses ConfigService.isProduction() and APP_NAME', async () => {
    const res = await fetch(`${baseUrl}/api/v1/hello/health`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      status: string
      app: string
      mode: string
    }

    expect(body.status).toBe('ok')
    expect(body.app).toBe('KickJS V3 Preview')
    expect(body.mode).toBe('development')
  })
})
