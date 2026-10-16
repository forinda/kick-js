import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

// `disableInProd` fails closed: only an explicit development/test NODE_ENV
// mounts the docs — an unset one is production.
describe('SwaggerAdapter disableInProd', () => {
  const original = process.env.NODE_ENV
  afterEach(() => {
    if (original === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = original
  })

  const mountedRoutes = (nodeEnv: string | undefined) => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
    const adapter = SwaggerAdapter({ info: { title: 'T', version: '1' }, disableInProd: true })
    const http = { use: vi.fn(), route: vi.fn(), serveStatic: vi.fn() }
    adapter.beforeMount?.({ http } as any)
    return http.route.mock.calls.length
  }

  it.each([[undefined], ['production'], ['staging']])('NODE_ENV=%s mounts nothing', (env) => {
    expect(mountedRoutes(env)).toBe(0)
  })

  it.each([['development'], ['test']])('NODE_ENV=%s mounts the docs', (env) => {
    expect(mountedRoutes(env)).toBeGreaterThan(0)
  })
})
