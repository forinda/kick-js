/**
 * h3 behind a node server: `trustProxy` forms and connect middleware paths.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { h3Runtime } from '../src/http/runtimes/h3'
import type { RuntimeAppOptions, UseConnectOptions } from '../src/http/runtime'

const servers: Array<ReturnType<typeof createServer>> = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

/** Boot an h3 app whose only middleware answers with `req.ip` (or `hit`). */
async function boot(options: RuntimeAppOptions, path?: UseConnectOptions['path']) {
  const runtime = h3Runtime()
  const app = runtime.createApp(options)
  runtime.useConnect(
    app,
    ((req: IncomingMessage & { ip?: string }, res: ServerResponse) =>
      res.end(path === undefined ? (req.ip ?? 'none') : 'hit')) as never,
    path === undefined ? undefined : { path },
  )
  const server = createServer(runtime.nodeHandler(app) as never)
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return (url: string, xff?: string) =>
    fetch(base + url, { headers: xff ? { 'x-forwarded-for': xff } : {} }).then((r) =>
      r.status === 200 ? r.text() : `status ${r.status}`,
    )
}

describe('h3 trustProxy', () => {
  const chain = '203.0.113.9, 198.51.100.7'

  it('is off by default', async () => {
    expect(await (await boot({}))('/', chain)).toBe('none')
  })

  it('true trusts every hop', async () => {
    expect(await (await boot({ trustProxy: true }))('/', chain)).toBe('203.0.113.9')
  })

  it('a hop count trusts only that many proxies', async () => {
    // socket (1 hop) trusted → next address in from the right.
    expect(await (await boot({ trustProxy: 1 }))('/', chain)).toBe('198.51.100.7')
  })

  it('a predicate decides per hop', async () => {
    const get = await boot({ trustProxy: (ip) => ip === '127.0.0.1' })
    expect(await get('/', chain)).toBe('198.51.100.7')
  })

  it('an address list is refused, not read as true', async () => {
    expect(await (await boot({ trustProxy: 'loopback' }))('/', chain)).toBe('none')
  })
})

describe('h3 useConnect paths', () => {
  it('mounts each member of a list', async () => {
    const get = await boot({}, ['/a', '/b'])
    expect(await get('/a/x')).toBe('hit')
    expect(await get('/b')).toBe('hit')
    expect(await get('/c')).toBe('status 404')
  })

  it('matches a regular expression against the pathname', async () => {
    const get = await boot({}, /^\/admin/)
    expect(await get('/admin/users')).toBe('hit')
    expect(await get('/public')).toBe('status 404')
  })
})
