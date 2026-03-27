import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

export interface SessionData {
  [key: string]: unknown
}

export interface SessionStore {
  get(sid: string): Promise<SessionData | null>
  set(sid: string, data: SessionData, maxAge: number): Promise<void>
  destroy(sid: string): Promise<void>
  touch?(sid: string, maxAge: number): Promise<void>
}

export interface Session {
  id: string
  data: SessionData
  regenerate(): Promise<void>
  destroy(): Promise<void>
  save(): Promise<void>
}

export interface SessionOptions {
  /** Secret used to sign the session cookie (required) */
  secret: string
  /** Cookie name (default: 'kick.sid') */
  cookieName?: string
  /** Session max age in milliseconds (default: 86400000 = 24h) */
  maxAge?: number
  /** Reset maxAge on every response (default: false) */
  rolling?: boolean
  /** Save new sessions that have not been modified (default: true) */
  saveUninitialized?: boolean
  /** Cookie options */
  cookie?: {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'strict' | 'lax' | 'none'
    path?: string
    domain?: string
  }
  /** Custom session store (default: in-memory store with TTL cleanup) */
  store?: SessionStore
}

// ── In-Memory Store ───────────────────────────────────────────────────

class MemoryStore implements SessionStore {
  private sessions = new Map<string, { data: SessionData; expires: number }>()
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor() {
    // Purge expired sessions every 60 seconds
    this.cleanupInterval = setInterval(() => this.purge(), 60_000)
    this.cleanupInterval.unref()
  }

  async get(sid: string): Promise<SessionData | null> {
    const entry = this.sessions.get(sid)
    if (!entry) return null
    if (Date.now() > entry.expires) {
      this.sessions.delete(sid)
      return null
    }
    return entry.data
  }

  async set(sid: string, data: SessionData, maxAge: number): Promise<void> {
    this.sessions.set(sid, { data, expires: Date.now() + maxAge })
  }

  async destroy(sid: string): Promise<void> {
    this.sessions.delete(sid)
  }

  async touch(sid: string, maxAge: number): Promise<void> {
    const entry = this.sessions.get(sid)
    if (entry) {
      entry.expires = Date.now() + maxAge
    }
  }

  private purge() {
    const now = Date.now()
    for (const [sid, entry] of this.sessions) {
      if (now > entry.expires) {
        this.sessions.delete(sid)
      }
    }
  }
}

// ── Cookie Signing ────────────────────────────────────────────────────

function sign(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64url')
  return `s:${value}.${signature}`
}

function unsign(signed: string, secret: string): string | false {
  if (!signed.startsWith('s:')) return false
  const raw = signed.slice(2)
  const dotIndex = raw.lastIndexOf('.')
  if (dotIndex === -1) return false

  const value = raw.slice(0, dotIndex)
  const providedSig = raw.slice(dotIndex + 1)
  const expectedSig = createHmac('sha256', secret).update(value).digest('base64url')

  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return false
  }

  return value
}

// ── Middleware Factory ────────────────────────────────────────────────

/**
 * Session management middleware.
 *
 * Attaches a `req.session` object with `id`, `data`, `regenerate()`,
 * `destroy()`, and `save()` methods. Session IDs are signed with
 * HMAC-SHA256 to prevent cookie tampering.
 *
 * @example
 * ```ts
 * import { session } from '@forinda/kickjs-http'
 *
 * bootstrap({
 *   modules,
 *   middleware: [
 *     cookieParser(),
 *     session({ secret: process.env.SESSION_SECRET! }),
 *     // ... other middleware
 *   ],
 * })
 * ```
 */
export function session(options: SessionOptions) {
  const {
    secret,
    cookieName = 'kick.sid',
    maxAge = 86_400_000,
    rolling = false,
    saveUninitialized = true,
    store = new MemoryStore(),
    cookie: cookieOpts = {},
  } = options

  const cookieDefaults = {
    httpOnly: cookieOpts.httpOnly ?? true,
    secure: cookieOpts.secure ?? process.env.NODE_ENV === 'production',
    sameSite: cookieOpts.sameSite ?? ('lax' as const),
    path: cookieOpts.path ?? '/',
    ...(cookieOpts.domain ? { domain: cookieOpts.domain } : {}),
    maxAge,
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const cookies = (req as any).cookies || {}
    const signedCookie = cookies[cookieName]
    let sid: string | false = false
    let sessionData: SessionData | null = null
    let isNew = false

    // Attempt to recover existing session
    if (signedCookie) {
      sid = unsign(signedCookie, secret)
      if (sid) {
        sessionData = await store.get(sid)
      }
    }

    // Create new session if none found
    if (!sid || !sessionData) {
      sid = randomUUID()
      sessionData = {}
      isNew = true
    }

    let currentSid = sid as string
    let currentData = { ...sessionData }
    let destroyed = false

    const sessionObj: Session = {
      get id() {
        return currentSid
      },
      data: currentData,

      async regenerate() {
        await store.destroy(currentSid)
        currentSid = randomUUID()
        currentData = {}
        sessionObj.data = currentData
        await store.set(currentSid, currentData, maxAge)
        res.cookie(cookieName, sign(currentSid, secret), cookieDefaults)
      },

      async destroy() {
        await store.destroy(currentSid)
        destroyed = true
        currentData = {}
        sessionObj.data = currentData
        res.clearCookie(cookieName, { path: cookieDefaults.path })
      },

      async save() {
        if (!destroyed) {
          await store.set(currentSid, currentData, maxAge)
        }
      },
    }

    ;(req as any).session = sessionObj

    // Set cookie for new sessions
    if (isNew) {
      res.cookie(cookieName, sign(currentSid, secret), cookieDefaults)
    }

    // Auto-save on response finish
    res.on('finish', async () => {
      if (destroyed) return
      if (isNew && !saveUninitialized && Object.keys(currentData).length === 0) return

      await store.set(currentSid, currentData, maxAge)

      if (rolling && !isNew) {
        if (store.touch) {
          await store.touch(currentSid, maxAge)
        }
      }
    })

    // Rolling: refresh cookie on every response
    if (rolling && !isNew) {
      res.cookie(cookieName, sign(currentSid, secret), cookieDefaults)
    }

    next()
  }
}
