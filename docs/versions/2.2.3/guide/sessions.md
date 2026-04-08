# Session Management

KickJS provides cookie-based session middleware with HMAC-SHA256 signing, automatic TTL cleanup, and a pluggable store interface.

## Basic Usage

```ts
import cookieParser from 'cookie-parser'
import { session } from '@forinda/kickjs'

bootstrap({
  modules,
  middleware: [
    cookieParser(),
    session({ secret: process.env.SESSION_SECRET! }),
  ],
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `secret` | `string` | **required** | Secret for signing the session cookie |
| `cookieName` | `string` | `'kick.sid'` | Cookie name |
| `maxAge` | `number` | `86400000` (24h) | Session TTL in milliseconds |
| `rolling` | `boolean` | `false` | Reset TTL on every request |
| `saveUninitialized` | `boolean` | `true` | Save empty sessions |
| `cookie.httpOnly` | `boolean` | `true` | HTTP-only cookie |
| `cookie.secure` | `boolean` | `true` in production | Secure cookie |
| `cookie.sameSite` | `string` | `'lax'` | SameSite attribute |
| `cookie.path` | `string` | `'/'` | Cookie path |
| `cookie.domain` | `string` | — | Cookie domain |
| `store` | `SessionStore` | In-memory | Custom session store |

## Using Sessions in Controllers

Access the session via `ctx.session`:

```ts
@Controller('/auth')
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
    if (!userId) return ctx.res.status(401).json({ message: 'Not authenticated' })
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

## Session API

The `req.session` (or `ctx.session`) object provides:

| Property/Method | Description |
|-----------------|-------------|
| `id` | Current session ID |
| `data` | Key-value session data object |
| `regenerate()` | Create a new session ID (prevents fixation attacks) |
| `destroy()` | Delete the session and clear the cookie |
| `save()` | Manually save the session (auto-saves on response finish) |

## Rolling Sessions

Keep sessions alive as long as the user is active:

```ts
session({
  secret: 'my-secret',
  rolling: true,
  maxAge: 30 * 60_000, // 30 minutes of inactivity
})
```

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

## Security Notes

- Session cookies are signed with **HMAC-SHA256** using timing-safe comparison
- Always use a strong, random `secret` — at least 32 characters
- Set `cookie.secure: true` in production (done automatically when `NODE_ENV === 'production'`)
- Call `session.regenerate()` after login to prevent session fixation
- Use `cookie-parser` middleware before `session()` in the middleware pipeline
