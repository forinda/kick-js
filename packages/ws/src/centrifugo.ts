/**
 * Centrifugo integration. Centrifugo holds the client connections; KickJS
 * issues connection tokens (or answers its connect proxy) and publishes
 * through its server API.
 *
 * ```ts
 * import { CentrifugoAdapter } from '@forinda/kickjs-ws/centrifugo'
 *
 * bootstrap({
 *   modules,
 *   adapters: [CentrifugoAdapter({ url: 'http://centrifugo:8000', apiKey: process.env.CENTRIFUGO_API_KEY! })],
 * })
 * ```
 *
 * `@WsController` / `@OnMessage` do not apply here: those handle sockets the
 * Node process owns, and with Centrifugo it owns none.
 *
 * @module @forinda/kickjs-ws/centrifugo
 */
import { createHmac } from 'node:crypto'
import { createLogger, createToken, defineAdapter } from '@forinda/kickjs'
import { WS_USER_BROADCASTER, type WsAuthenticatedUser, type WsUserBroadcaster } from './interfaces'

const log = createLogger('CentrifugoAdapter')

export interface CentrifugoClientOptions {
  /** Centrifugo base URL, e.g. `http://centrifugo:8000`. The client calls `<url>/api/<method>`. */
  url: string
  /** `http_api.key` from the Centrifugo config, sent as `X-API-Key`. */
  apiKey: string
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch
}

/** Centrifugo server API — the subset KickJS services need. */
export interface CentrifugoClient {
  /** Publish `data` (any JSON value) to one channel. */
  publish(channel: string, data: unknown): Promise<void>
  /** Publish the same `data` to several channels in one call. */
  broadcast(channels: string[], data: unknown): Promise<void>
  /** Subscribe every connection of `user` to `channel`, server-side. */
  subscribe(user: string, channel: string): Promise<void>
  /** Disconnect every connection of `user`. */
  disconnect(user: string): Promise<void>
}

/** Thrown when Centrifugo answers non-2xx, or 200 with an `error` object. */
export class CentrifugoApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`Centrifugo ${method} failed (${code}): ${message}`)
    this.name = 'CentrifugoApiError'
  }
}

export function centrifugoClient({
  url,
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
}: CentrifugoClientOptions): CentrifugoClient {
  const base = url.replace(/\/+$/, '')

  const call = async (method: string, body: Record<string, unknown>): Promise<void> => {
    const res = await fetchImpl(`${base}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new CentrifugoApiError(method, res.status, res.statusText || 'HTTP error')
    // By default Centrifugo reports API errors with HTTP 200 and an `error`
    // object in the body (internal/api/handler_gen.go); only the opt-in
    // transport error mode maps them to HTTP status codes.
    const reply = (await res.json().catch(() => ({}))) as {
      error?: { code: number; message: string }
    }
    if (reply.error) throw new CentrifugoApiError(method, reply.error.code, reply.error.message)
  }

  return {
    publish: (channel, data) => call('publish', { channel, data }),
    broadcast: (channels, data) => call('broadcast', { channels, data }),
    subscribe: (user, channel) => call('subscribe', { user, channel }),
    disconnect: (user) => call('disconnect', { user }),
  }
}

export interface ConnectionTokenOptions {
  /** `client.token.hmac_secret_key` from the Centrifugo config. */
  secret: string
  /** User id. An empty string connects anonymously, if Centrifugo allows it. */
  sub: string
  /** Token lifetime. Omit for a token that never expires. */
  expiresInSeconds?: number
  /** Connection info, visible to other clients in presence and join/leave events. */
  info?: unknown
  /** Channels to subscribe the connection to server-side. */
  channels?: string[]
}

const base64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url')

/**
 * An HS256 connection JWT. Claims follow Centrifugo's `ConnectTokenClaims`
 * (internal/jwtverify/token_verifier_jwt.go): `sub`, `exp`, `info`, `channels`.
 */
export function connectionToken({
  secret,
  sub,
  expiresInSeconds,
  info,
  channels,
}: ConnectionTokenOptions): string {
  const claims: Record<string, unknown> = { sub }
  if (expiresInSeconds !== undefined) {
    claims.exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  }
  if (info !== undefined) claims.info = info
  if (channels !== undefined) claims.channels = channels

  const unsigned = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

/** Body a connect proxy endpoint returns (internal/proxyproto/proxy.proto `ConnectResponse`). */
export type CentrifugoConnectReply =
  | { result: { user: string } }
  | { disconnect: { code: number; reason: string } }
  | { error: { code: number; message: string } }

/**
 * Answer Centrifugo's connect proxy with the same `resolveUser` a `WsAdapter`
 * uses. A user connects; `null` or a user without an id disconnects with
 * `4401` (the code `WsAdapter` closes with); a throwing resolver answers
 * error `100`, Centrifugo's internal error, so the client may retry.
 *
 * Centrifugo forwards only the headers listed in
 * `client.proxy.connect.http_headers` — add `Cookie` or `Authorization` there,
 * or `resolveUser` sees none.
 */
export async function centrifugoConnect<Req>(
  request: Req,
  resolveUser: (request: Req) => Promise<WsAuthenticatedUser | null> | WsAuthenticatedUser | null,
): Promise<CentrifugoConnectReply> {
  try {
    const user = await resolveUser(request)
    if (!user || !user.id) return { disconnect: { code: 4401, reason: 'unauthorized' } }
    return { result: { user: String(user.id) } }
  } catch (err) {
    log.error({ err }, 'Centrifugo connect proxy: resolveUser threw')
    return { error: { code: 100, message: 'internal server error' } }
  }
}

/** DI token for the {@link CentrifugoClient} registered by {@link CentrifugoAdapter}. */
export const CENTRIFUGO = createToken<CentrifugoClient>('kick/ws/Centrifugo')

export interface CentrifugoAdapterOptions extends CentrifugoClientOptions {
  /**
   * `client.subscribe_to_user_personal_channel.personal_channel_namespace`.
   * Leave unset when that option is unset: the personal channel is then
   * `#<user>`, otherwise `<namespace>:#<user>` (internal/config/container.go).
   */
  personalChannelNamespace?: string
}

/**
 * Registers {@link CENTRIFUGO} and a `WS_USER_BROADCASTER` that publishes to
 * the user's personal channel, so services written against `WsAdapter`'s
 * broadcaster keep working. Enable
 * `client.subscribe_to_user_personal_channel` in Centrifugo so users are
 * subscribed to that channel on connect.
 */
export const CentrifugoAdapter = defineAdapter<CentrifugoAdapterOptions>({
  name: 'CentrifugoAdapter',
  build: (options) => {
    const client = centrifugoClient(options)
    const roomFor = (userId: string): string =>
      options.personalChannelNamespace
        ? `${options.personalChannelNamespace}:#${userId}`
        : `#${userId}`

    // The broadcaster interface is synchronous; a failed publish is logged,
    // matching how WsAdapter treats a broker outage.
    const broadcastToUser = (userId: string, event: string, data: unknown): void => {
      client
        .publish(roomFor(userId), { event, data })
        .catch((err) => log.error({ err }, 'Centrifugo publish failed'))
    }

    const broadcaster: WsUserBroadcaster = {
      roomFor,
      broadcastToUser,
      toUser: (id) => ({ send: (event, data) => broadcastToUser(id, event, data) }),
    }

    return {
      beforeStart({ container }) {
        container.registerInstance(CENTRIFUGO, client)
        container.registerInstance(WS_USER_BROADCASTER, broadcaster)
      },
    }
  },
})
