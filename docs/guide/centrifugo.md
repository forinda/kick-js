# Centrifugo

[Centrifugo](https://centrifugal.dev) is a standalone real-time server. Clients connect to it, not to your Node process; your KickJS app authenticates those connections and publishes through Centrifugo's server API. `@forinda/kickjs-ws/centrifugo` covers the KickJS side.

## When to choose it

|                                          | `WsAdapter` + Redis broker | Centrifugo                                                      |
| ---------------------------------------- | -------------------------- | --------------------------------------------------------------- |
| Who holds the sockets                    | Your Node instances        | Centrifugo (Go)                                                 |
| Client → server messages                 | `@OnMessage` handlers      | Your HTTP routes, or Centrifugo's RPC/publish proxies           |
| Extra infrastructure                     | Redis                      | Centrifugo (plus its own Redis/NATS when you run several nodes) |
| History, presence, recovery on reconnect | Build it yourself          | Built in                                                        |

Start with [`WsAdapter`](./websockets.md) — it keeps handlers in your code and scales out with a [broker](./websockets.md#scaling-across-instances). Move to Centrifugo when connection count or delivery features outgrow what you want to run in Node.

## What does not carry over

Centrifugo owns the connections, so nothing that acts on a socket applies: `@WsController`, `@OnConnect`, `@OnMessage`, `@OnDisconnect`, `WsContext`, rooms (`ctx.join`, `ctx.to`) and `WS_ROOM_MANAGER`. Channels replace rooms; clients subscribe to them, or you subscribe users server-side with `subscribe(user, channel)`.

`WS_USER_BROADCASTER` does carry over — see [Publishing from services](#publishing-from-services).

## Centrifugo config

Keys as Centrifugo v6 reads them (`config.json`, or `CENTRIFUGO_`-prefixed environment variables such as `CENTRIFUGO_HTTP_API_KEY`):

```json
{
  "http_api": { "key": "<api key>" },
  "client": {
    "allowed_origins": ["https://app.example.com"],
    "token": { "hmac_secret_key": "<hmac secret>" },
    "subscribe_to_user_personal_channel": { "enabled": true },
    "proxy": {
      "connect": {
        "enabled": true,
        "endpoint": "http://api:3000/centrifugo/connect",
        "http_headers": ["Cookie"]
      }
    }
  },
  "channel": {
    "without_namespace": { "allow_subscribe_for_client": true }
  }
}
```

- `http_api.key` — what `CentrifugoAdapter` sends as `X-API-Key`.
- `client.token.hmac_secret_key` — what `connectionToken` signs with. Needed only for the token flow.
- `client.proxy.connect` — needed only for the proxy flow. Centrifugo forwards **only** the headers listed in `http_headers`; without `Cookie` your resolver sees no session.
- `client.subscribe_to_user_personal_channel` — subscribes each user to `#<user>` on connect, which is where `WS_USER_BROADCASTER` publishes.

## Register the adapter

```ts
import { bootstrap } from '@forinda/kickjs'
import { CentrifugoAdapter } from '@forinda/kickjs-ws/centrifugo'

bootstrap({
  modules,
  adapters: [
    CentrifugoAdapter({
      url: process.env.CENTRIFUGO_URL!, // e.g. http://centrifugo:8000
      apiKey: process.env.CENTRIFUGO_API_KEY!,
    }),
  ],
})
```

If you set `client.subscribe_to_user_personal_channel.personal_channel_namespace`, pass the same value as `personalChannelNamespace` so the broadcaster publishes to `<namespace>:#<user>`.

## Authenticating connections

Pick one of two flows.

### Connection token

Your app signs a short-lived JWT; the client passes it to Centrifugo.

```ts
import { Controller, Get, type RequestContext } from '@forinda/kickjs'
import { connectionToken } from '@forinda/kickjs-ws/centrifugo'

@Controller()
export class RealtimeController {
  @Get('/token')
  async token(ctx: RequestContext) {
    const user = await sessions.fromRequest(ctx.req) // your session lookup
    if (!user) return ctx.json({ error: 'unauthorized' }, 401)

    ctx.json({
      token: connectionToken({
        secret: process.env.CENTRIFUGO_HMAC_SECRET!,
        sub: user.id,
        expiresInSeconds: 15 * 60,
        info: { name: user.name }, // visible to others in presence
      }),
    })
  }
}
```

`connectionToken` signs HS256 with `node:crypto` and sets the `sub`, `exp`, `info` and `channels` claims Centrifugo reads.

### Connect proxy

Centrifugo calls your app on every connection and uses the reply. Reuse the `resolveUser` you would give `WsAdapter`:

```ts
import { Controller, Post, type RequestContext } from '@forinda/kickjs'
import { centrifugoConnect } from '@forinda/kickjs-ws/centrifugo'

// Mount under /centrifugo so the path matches client.proxy.connect.endpoint
@Controller()
export class CentrifugoProxyController {
  @Post('/connect')
  async connect(ctx: RequestContext) {
    ctx.json(await centrifugoConnect(ctx.req, resolveUser))
  }
}

// The same shape as WsAuthConfig.resolveUser
async function resolveUser(req: { headers: Record<string, string | string[] | undefined> }) {
  const sid = parseCookie(req.headers.cookie).sid
  return sid ? await sessions.verify(sid) : null
}
```

| `resolveUser`               | Reply                                                        | Client sees                                      |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| returns `{ id }`            | `{ result: { user: id } }`                                   | connected as that user                           |
| returns `null` (or no `id`) | `{ disconnect: { code: 4401, reason: 'unauthorized' } }`     | socket closed with `4401`                        |
| throws                      | `{ error: { code: 100, message: 'internal server error' } }` | connect error (Centrifugo's internal error code) |

The route must be reachable from Centrifugo, and exempt from `csrf()` if you use it — Centrifugo sends no CSRF token.

## Publishing from services

`CentrifugoAdapter` registers two tokens:

```ts
import { Inject, Service } from '@forinda/kickjs'
import { WS_USER_BROADCASTER, type WsUserBroadcaster } from '@forinda/kickjs-ws'
import { CENTRIFUGO, type CentrifugoClient } from '@forinda/kickjs-ws/centrifugo'

@Service()
export class OrderEvents {
  constructor(
    @Inject(CENTRIFUGO) private readonly centrifugo: CentrifugoClient,
    @Inject(WS_USER_BROADCASTER) private readonly users: WsUserBroadcaster,
  ) {}

  async shipped(order: { id: string; userId: string }) {
    await this.centrifugo.publish(`orders:${order.id}`, { status: 'shipped' })
    this.users.toUser(order.userId).send('order:shipped', { id: order.id })
  }
}
```

- `CENTRIFUGO` — `publish(channel, data)`, `broadcast(channels, data)`, `subscribe(user, channel)`, `disconnect(user)`. Each returns a promise and throws `CentrifugoApiError` (with `method` and `code`) when Centrifugo rejects the call.
- `WS_USER_BROADCASTER` — the same interface `WsAdapter` registers. It publishes `{ event, data }` to the user's personal channel. Code written against `WsAdapter` works unchanged; like `WsAdapter`'s broker relay, a failed publish is logged rather than thrown.

## Client

Use Centrifugo's client SDK:

<PmCommand add="centrifuge" />

```ts
import { Centrifuge } from 'centrifuge'

const centrifuge = new Centrifuge('wss://realtime.example.com/connection/websocket', {
  // Token flow; omit for the connect proxy flow
  getToken: async () => (await fetch('/token').then((r) => r.json())).token,
})

// Server-side subscriptions, including the personal channel
centrifuge.on('publication', (ctx) => console.log(ctx.channel, ctx.data))

const orders = centrifuge.newSubscription('orders:42')
orders.on('publication', (ctx) => console.log(ctx.data))
orders.subscribe()

centrifuge.connect()
```
