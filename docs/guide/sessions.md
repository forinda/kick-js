# Session Management

KickJS provides cookie-based session middleware with HMAC-SHA256 signing, automatic TTL cleanup, and a pluggable store interface.

## Basic Usage

```ts
import { session } from '@forinda/kickjs'

bootstrap({
  modules,
  middlewares: [session({ secret: process.env.SESSION_SECRET! })],
})
```

`session()` parses the incoming `Cookie` header itself, so no upstream
cookie parser is required. If one is already installed (e.g.
`cookie-parser` or another middleware that sets `req.cookies`), the
session middleware reuses it and will not re-parse.

## Options

| Option              | Type                       | Default              | Description                                                                        |
| ------------------- | -------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `secret`            | `string \| string[]`       | **required**         | Secret for signing the session cookie; a list to [rotate it](#rotating-the-secret) |
| `cookieName`        | `string`                   | `'kick.sid'`         | Cookie name                                                                        |
| `maxAge`            | `number`                   | `86400000` (24h)     | Session TTL in milliseconds                                                        |
| `rolling`           | `boolean`                  | `false`              | Reset TTL on every request                                                         |
| `saveUninitialized` | `boolean`                  | `true`               | Save empty sessions                                                                |
| `cookie.httpOnly`   | `boolean`                  | `true`               | HTTP-only cookie                                                                   |
| `cookie.secure`     | `boolean`                  | `true` in production | Secure cookie                                                                      |
| `cookie.sameSite`   | `string`                   | `'lax'`              | SameSite attribute                                                                 |
| `cookie.path`       | `string`                   | `'/'`                | Cookie path                                                                        |
| `cookie.domain`     | `string`                   | —                    | Cookie domain                                                                      |
| `store`             | `SessionStore \| 'cookie'` | In-memory            | Where the data lives — see below                                                   |

## Using Sessions in Controllers

Access the session via `ctx.session`:

```ts
@Controller()
class AuthController {
  @Post('/login')
  async login(ctx: RequestContext) {
    const user = await this.authService.authenticate(ctx.body)
    ctx.session.data.userId = user.id
    ctx.session.data.role = user.role
    await ctx.session.save()
    ctx.json({ message: 'Logged in' })
  }

  @Get('/me')
  async me(ctx: RequestContext) {
    const userId = ctx.session.data.userId
    if (!userId) {
      ctx.problem.unauthorized({ detail: 'Not authenticated' })
      return
    }
    const user = await this.userService.findById(userId)
    ctx.json(user)
  }

  @Post('/logout')
  async logout(ctx: RequestContext) {
    await ctx.session.destroy()
    ctx.json({ message: 'Logged out' })
  }
}
```

## Typing session data

`ctx.session` is typed `Session`, and `ctx.session.data` is a `SessionData`. Declare your keys once and every read is typed:

```ts
// src/types/session.d.ts — or next to the code that sets them
export {} // keeps the file a module, so this augments the package instead of replacing it

declare module '@forinda/kickjs' {
  interface SessionData {
    userId?: string
    role?: 'admin' | 'member'
  }
}
```

```ts
const userId = ctx.session.data.userId // string | undefined
```

Keys you don't declare are still readable, as `unknown`.

## Session API

The `req.session` (or `ctx.session`) object provides:

| Property/Method | Description                                               |
| --------------- | --------------------------------------------------------- |
| `id`            | Current session ID                                        |
| `data`          | Key-value session data object                             |
| `regenerate()`  | Create a new session ID (prevents fixation attacks)       |
| `destroy()`     | Delete the session and clear the cookie                   |
| `save()`        | Manually save the session (auto-saves on response finish) |

## Rolling Sessions

Keep sessions alive as long as the user is active:

```ts
session({
  secret: 'my-secret',
  rolling: true,
  maxAge: 30 * 60_000, // 30 minutes of inactivity
})
```

## Cookie store

The default store keeps sessions in the memory of one process, at most 10,000 of them. A visitor without a cookie gets a session, so a client could otherwise create one per request. Past the cap, an empty session is dropped first. A flood of cookieless requests only creates empty ones, so it can't push out sessions that hold a login. Only when every session holds data is the least recently written one dropped, and that visitor starts a new one. With more than one — several containers behind a load balancer, or Netlify and Vercel functions, where each request may land on a new instance — the next request can reach a process that has never seen the session.

`store: 'cookie'` keeps the session data in the cookie itself, so every instance reads it, with nothing shared between them:

```ts
session({ secret: process.env.SESSION_SECRET!, store: 'cookie' })
```

- The data is **encrypted** (AES-256-GCM, under a key derived from `secret`), so the browser can neither read nor change it. A cookie that was altered, written with another secret, or past `maxAge` starts a fresh session.
- It must fit in a cookie. Browsers drop one over about 4 KB, and a warning is logged when a session grows past that. Keep ids, flags and short messages in it; keep records in the database.
- The cookie is rewritten only when the data changed, just before the response's headers are sent, so changes made anywhere in the request are included. `save()` writes it straight away.
- `destroy()` clears the browser's cookie, but a copy taken before stays valid until it expires — the server keeps no list to revoke it from. Keep `maxAge` short where that matters, or use a shared store.

## Custom Store (Redis)

Implement `SessionStore` for production deployments:

```ts
import type { SessionStore, SessionData } from '@forinda/kickjs'

class RedisSessionStore implements SessionStore {
  constructor(private redis: Redis) {}

  async get(sid: string): Promise<SessionData | null> {
    const data = await this.redis.get(`sess:${sid}`)
    return data ? JSON.parse(data) : null
  }

  async set(sid: string, data: SessionData, maxAge: number) {
    await this.redis.set(`sess:${sid}`, JSON.stringify(data), 'PX', maxAge)
  }

  async destroy(sid: string) {
    await this.redis.del(`sess:${sid}`)
  }

  async touch(sid: string, maxAge: number) {
    await this.redis.pexpire(`sess:${sid}`, maxAge)
  }
}

session({ secret: 'my-secret', store: new RedisSessionStore(redis) })
```

## Rotating the secret

Pass a list to change the secret without logging everyone out. The first secret signs (or, with `store: 'cookie'`, encrypts) new cookies, and every secret in the list is accepted:

```ts
session({ secret: [process.env.SESSION_SECRET!, process.env.SESSION_SECRET_OLD!] })
```

A cookie made with an older secret is re-issued with the first one on the next response. Once `maxAge` has passed since the change, every active session has moved over and the old secret can be removed. Rotate when a secret may have leaked, or on a schedule.

## Security Notes

- Session cookies are signed with **HMAC-SHA256** using timing-safe comparison; with `store: 'cookie'` the whole value is encrypted and authenticated with AES-256-GCM
- Always use a strong, random `secret` — at least 32 characters
- Set `cookie.secure: true` in production (done automatically when `NODE_ENV === 'production'`)
- Call `session.regenerate()` after login to prevent session fixation
- `session()` parses cookies internally — `cookie-parser` is optional, not required
