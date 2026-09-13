/**
 * Centrifugo integration: the server API client against a local fake of
 * Centrifugo's HTTP API, the HS256 connection token, the connect-proxy reply,
 * and the adapter's DI registrations. The last suite runs against a real
 * Centrifugo when CENTRIFUGO_URL is set (see the suite for the config it expects).
 *
 * @module @forinda/kickjs-ws/__tests__/centrifugo.test
 */
import 'reflect-metadata'
import http from 'node:http'
import { createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { WebSocket } from 'ws'
import { Container } from '@forinda/kickjs'
import { WS_USER_BROADCASTER } from '@forinda/kickjs-ws'
import {
  CENTRIFUGO,
  CentrifugoAdapter,
  CentrifugoApiError,
  centrifugoClient,
  centrifugoConnect,
  connectionToken,
} from '../src/centrifugo'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

interface Call {
  path: string
  apiKey: string | undefined
  body: any
}

/** Centrifugo's HTTP API shape: 200 + `result`, or 200 + `error` (its default error mode). */
async function fakeCentrifugo() {
  const calls: Call[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      calls.push({ path: req.url!, apiKey: req.headers['x-api-key'] as string, body })
      if (body.channel === 'boom') {
        res.writeHead(500).end()
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify(
          body.channel === 'unknown'
            ? { error: { code: 102, message: 'unknown channel' } }
            : { result: {} },
        ),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  cleanups.push(() => server.close())
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, calls }
}

describe('centrifugoClient', () => {
  it('posts each method to /api/<method> with X-API-Key and the documented body', async () => {
    const { url, calls } = await fakeCentrifugo()
    const client = centrifugoClient({ url: `${url}/`, apiKey: 'k1' })

    await client.publish('news', { title: 'hi' })
    await client.broadcast(['a', 'b'], 1)
    await client.subscribe('alice', 'news')
    await client.disconnect('alice')

    expect(calls).toEqual([
      { path: '/api/publish', apiKey: 'k1', body: { channel: 'news', data: { title: 'hi' } } },
      { path: '/api/broadcast', apiKey: 'k1', body: { channels: ['a', 'b'], data: 1 } },
      { path: '/api/subscribe', apiKey: 'k1', body: { user: 'alice', channel: 'news' } },
      { path: '/api/disconnect', apiKey: 'k1', body: { user: 'alice' } },
    ])
  })

  it('throws on an error object in a 200 reply', async () => {
    const { url } = await fakeCentrifugo()
    const err = await centrifugoClient({ url, apiKey: 'k' })
      .publish('unknown', 1)
      .catch((e) => e)
    expect(err).toBeInstanceOf(CentrifugoApiError)
    expect(err).toMatchObject({ method: 'publish', code: 102 })
    expect(err.message).toContain('unknown channel')
  })

  it('throws on a non-2xx reply', async () => {
    const { url } = await fakeCentrifugo()
    await expect(centrifugoClient({ url, apiKey: 'k' }).publish('boom', 1)).rejects.toMatchObject({
      code: 500,
    })
  })
})

describe('connectionToken', () => {
  const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString())

  it('signs HS256 over header.payload with the secret and carries the claims', () => {
    const token = connectionToken({
      secret: 's3cret',
      sub: 'alice',
      expiresInSeconds: 60,
      info: { name: 'Alice' },
      channels: ['news'],
    })
    const [header, payload, signature] = token.split('.')

    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' })
    const expected = createHmac('sha256', 's3cret')
      .update(`${header}.${payload}`)
      .digest('base64url')
    expect(signature).toBe(expected)

    const claims = decode(payload)
    expect(claims).toMatchObject({ sub: 'alice', info: { name: 'Alice' }, channels: ['news'] })
    const now = Math.floor(Date.now() / 1000)
    expect(claims.exp).toBeGreaterThanOrEqual(now + 59)
    expect(claims.exp).toBeLessThanOrEqual(now + 60)
  })

  it('omits exp when no lifetime is given', () => {
    const [, payload] = connectionToken({ secret: 's', sub: 'u' }).split('.')
    expect(decode(payload)).toEqual({ sub: 'u' })
  })
})

describe('centrifugoConnect', () => {
  it('returns the user id as a string', async () => {
    await expect(centrifugoConnect({}, () => ({ id: 42 as unknown as string }))).resolves.toEqual({
      result: { user: '42' },
    })
  })

  it('disconnects with 4401 when there is no user', async () => {
    const rejected = { disconnect: { code: 4401, reason: 'unauthorized' } }
    await expect(centrifugoConnect({}, async () => null)).resolves.toEqual(rejected)
    await expect(centrifugoConnect({}, () => ({ id: '' }))).resolves.toEqual(rejected)
  })

  it('answers internal error 100 when the resolver throws', async () => {
    await expect(
      centrifugoConnect({}, () => {
        throw new Error('db down')
      }),
    ).resolves.toEqual({ error: { code: 100, message: 'internal server error' } })
  })
})

describe('CentrifugoAdapter', () => {
  beforeEach(() => Container.reset())

  async function start(options: { personalChannelNamespace?: string } = {}) {
    const { url, calls } = await fakeCentrifugo()
    const adapter = CentrifugoAdapter({ url, apiKey: 'k', ...options }) as any
    await adapter.beforeStart({ container: Container.getInstance() })
    return { calls, container: Container.getInstance() }
  }

  it('registers CENTRIFUGO and a user broadcaster publishing to #<user>', async () => {
    const { calls, container } = await start()
    expect(typeof container.resolve(CENTRIFUGO).publish).toBe('function')

    const users = container.resolve(WS_USER_BROADCASTER)
    expect(users.roomFor('alice')).toBe('#alice')
    users.toUser('alice').send('ping', 1)
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toEqual([
      {
        path: '/api/publish',
        apiKey: 'k',
        body: { channel: '#alice', data: { event: 'ping', data: 1 } },
      },
    ])
  })

  it('uses <namespace>:#<user> when a personal channel namespace is set', async () => {
    const { container } = await start({ personalChannelNamespace: 'personal' })
    expect(container.resolve(WS_USER_BROADCASTER).roomFor('alice')).toBe('personal:#alice')
  })
})

/**
 * Needs a Centrifugo v6 on CENTRIFUGO_URL reachable at 127.0.0.1 (e.g.
 * `docker run --network host`) started with:
 *   CENTRIFUGO_HTTP_API_KEY=api-key
 *   CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY=hmac-secret
 *   CENTRIFUGO_CLIENT_ALLOWED_ORIGINS=*
 *   CENTRIFUGO_CHANNEL_WITHOUT_NAMESPACE_ALLOW_SUBSCRIBE_FOR_CLIENT=true
 *   CENTRIFUGO_CLIENT_SUBSCRIBE_TO_USER_PERSONAL_CHANNEL_ENABLED=true
 *   CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED=true
 *   CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT=http://127.0.0.1:4799/centrifugo/connect
 *   CENTRIFUGO_CLIENT_PROXY_CONNECT_HTTP_HEADERS=Cookie
 */
const CENTRIFUGO_URL = process.env.CENTRIFUGO_URL
describe.skipIf(!CENTRIFUGO_URL)('Centrifugo (real server)', () => {
  const wsUrl = `${CENTRIFUGO_URL?.replace(/^http/, 'ws')}/connection/websocket`

  /** A raw client speaking Centrifugo's JSON protocol: newline-delimited replies per frame. */
  async function connect(command: object, headers: Record<string, string> = {}) {
    const ws = new WebSocket(wsUrl, { headers })
    cleanups.push(() => ws.terminate())
    const replies: any[] = []
    ws.on('message', (raw) => {
      for (const line of String(raw).split('\n').filter(Boolean)) {
        const reply = JSON.parse(line)
        if (Object.keys(reply).length === 0) ws.send('{}') // ping → pong
        else replies.push(reply)
      }
    })
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    ws.send(JSON.stringify({ id: 1, connect: command }))
    return { ws, replies, closed }
  }

  async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
    const until = Date.now() + ms
    while (!check()) {
      if (Date.now() > until) throw new Error('condition not met in time')
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  const client = () => centrifugoClient({ url: CENTRIFUGO_URL!, apiKey: 'api-key' })

  it('accepts a connectionToken and delivers a publish to a subscribed channel', async () => {
    const token = connectionToken({ secret: 'hmac-secret', sub: 'alice', expiresInSeconds: 60 })
    const { ws, replies } = await connect({ token })
    await waitFor(() => replies.some((r) => r.id === 1))
    expect(replies.find((r) => r.id === 1)).toHaveProperty('connect')

    ws.send(JSON.stringify({ id: 2, subscribe: { channel: 'news' } }))
    await waitFor(() => replies.some((r) => r.id === 2))
    await client().publish('news', { title: 'hello' })

    await waitFor(() => replies.some((r) => r.push?.channel === 'news'))
    expect(replies.find((r) => r.push?.channel === 'news').push.pub.data).toEqual({
      title: 'hello',
    })
  })

  it('rejects a token signed with the wrong secret', async () => {
    const token = connectionToken({ secret: 'wrong', sub: 'alice' })
    const { replies, closed } = await connect({ token })
    const outcome = await Promise.race([
      closed.then((code) => ({ code })),
      waitFor(() => replies.some((r) => r.id === 1)).then(() => replies.find((r) => r.id === 1)),
    ])
    expect(outcome).not.toHaveProperty('connect')
  })

  it('WS_USER_BROADCASTER reaches the user on their personal channel', async () => {
    Container.reset()
    const adapter = CentrifugoAdapter({ url: CENTRIFUGO_URL!, apiKey: 'api-key' }) as any
    await adapter.beforeStart({ container: Container.getInstance() })

    const token = connectionToken({ secret: 'hmac-secret', sub: 'bob', expiresInSeconds: 60 })
    const { replies } = await connect({ token })
    await waitFor(() => replies.some((r) => r.id === 1))

    Container.getInstance().resolve(WS_USER_BROADCASTER).broadcastToUser('bob', 'ping', 7)
    await waitFor(() => replies.some((r) => r.push?.channel === '#bob'))
    expect(replies.find((r) => r.push?.channel === '#bob').push.pub.data).toEqual({
      event: 'ping',
      data: 7,
    })
  })

  describe('connect proxy', () => {
    beforeEach(async () => {
      // The route an app would mount: forward the proxy body's request to
      // centrifugoConnect with the app's resolveUser.
      const server = http.createServer(async (req, res) => {
        req.resume()
        const reply = await centrifugoConnect(req, (r) => {
          const sid = /sid=(\w+)/.exec(r.headers.cookie ?? '')?.[1]
          return sid ? { id: sid } : null
        })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(reply))
      })
      await new Promise<void>((resolve) => server.listen(4799, '127.0.0.1', resolve))
      cleanups.push(() => server.close())
    })

    it('connects the user resolveUser returns, from the forwarded cookie', async () => {
      const { replies } = await connect({}, { Cookie: 'sid=carol' })
      await waitFor(() => replies.some((r) => r.id === 1))
      expect(replies.find((r) => r.id === 1).connect).toBeDefined()
    })

    it('closes with 4401 when resolveUser returns null', async () => {
      const { closed } = await connect({})
      expect(await closed).toBe(4401)
    })
  })
})
