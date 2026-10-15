import { parseCookieHeader, replaceCookie, setCookie } from './respond'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { createLogger } from '../../core/logger'
import type { Request, Response, NextFunction } from 'express'

import { registerDisposable } from '../../core/disposables'
import { isProduction } from '../../core/is-production'

/**
 * What a session holds. Augment it to type your keys — undeclared keys stay
 * readable as `unknown`:
 *
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface SessionData { userId?: string; cart?: string[] }
 * }
 * ```
 */
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
  /**
   * Secret that signs the session cookie — or, with `store: 'cookie'`,
   * encrypts it (required).
   *
   * Pass a list to rotate without logging everyone out: the first secret signs
   * new cookies, every secret is accepted, and a cookie made with an older one
   * is re-issued with the first. Drop the old secret once sessions have moved
   * over (after `maxAge`).
   *
   * ```ts
   * session({ secret: [process.env.SESSION_SECRET!, process.env.SESSION_SECRET_OLD!] })
   * ```
   */
  secret: string | string[]
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
  /**
   * Where session data lives. Default: in memory, in this process.
   *
   * `'cookie'` keeps it in the session cookie itself, encrypted with
   * AES-256-GCM under a key derived from `secret`: every instance reads the
   * same session with nothing shared between them — serverless functions,
   * several containers. The data has to fit a cookie (about 4 KB).
   *
   * Or pass a store shared between instances (`KvSessionStore`, Redis).
   */
  store?: SessionStore | 'cookie'
}

// ── In-Memory Store ───────────────────────────────────────────────────

// ponytail: fixed cap for the single-instance default; a shared store
// (KvSessionStore, Redis) is the answer for more.
const MAX_SESSIONS = 10_000

/** @internal Exported for tests. */
export class MemoryStore implements SessionStore {
  private readonly sessions = new Map<string, { data: SessionData; expires: number }>()
  private readonly cleanupInterval: ReturnType<typeof setInterval>

  constructor() {
    // Purge expired sessions every 60 seconds
    this.cleanupInterval = setInterval(() => this.purge(), 60_000)
    this.cleanupInterval.unref()
    // Symmetric teardown: Application.shutdown() drains the disposables
    // registry — without this, every in-process app re-create (tests, HMR)
    // leaked one live interval + its session Map.
    registerDisposable(() => this.dispose())
  }

  /** Clear the cleanup interval and drop all sessions. */
  dispose(): void {
    clearInterval(this.cleanupInterval)
    this.sessions.clear()
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
    // Deleted first so the map stays in last-written order, oldest at the front.
    this.sessions.delete(sid)
    this.sessions.set(sid, { data, expires: Date.now() + maxAge })
    // A session is created for every visitor without a cookie, so a client
    // can make as many as it sends requests: past the cap, the least
    // recently written goes (that visitor starts a new session).
    for (const oldest of this.sessions.keys()) {
      if (this.sessions.size <= MAX_SESSIONS) break
      this.sessions.delete(oldest)
    }
  }

  async destroy(sid: string): Promise<void> {
    this.sessions.delete(sid)
  }

  async touch(sid: string, maxAge: number): Promise<void> {
    const entry = this.sessions.get(sid)
    if (entry) {
      entry.expires = Date.now() + maxAge
      this.sessions.delete(sid)
      this.sessions.set(sid, entry)
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

/** `secret` as a non-empty list, newest first. */
function secretList(secret: string | string[]): string[] {
  const list = Array.isArray(secret) ? secret : [secret]
  if (list.length === 0 || list.some((s) => typeof s !== 'string' || s.length === 0)) {
    throw new Error('session(): `secret` must be a non-empty string or list of strings')
  }
  return list
}

function sign(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64url')
  return `s:${value}.${signature}`
}

/**
 * The signed value, and whether it was signed with an older secret than the
 * first (so the caller re-issues it); false when no secret verifies it.
 */
function unsign(signed: string, secrets: string[]): { value: string; stale: boolean } | false {
  if (!signed.startsWith('s:')) return false
  const raw = signed.slice(2)
  const dotIndex = raw.lastIndexOf('.')
  if (dotIndex === -1) return false

  const value = raw.slice(0, dotIndex)
  const provided = Buffer.from(raw.slice(dotIndex + 1))

  for (const [index, secret] of secrets.entries()) {
    const expected = Buffer.from(createHmac('sha256', secret).update(value).digest('base64url'))
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { value, stale: index > 0 }
    }
  }
  return false
}

// ── Middleware Factory ────────────────────────────────────────────────

/**
 * Session management middleware.
 *
 * Attaches a `req.session` object with `id`, `data`, `regenerate()`,
 * `destroy()`, and `save()` methods. Session IDs are signed with
 * HMAC-SHA256 to prevent cookie tampering.
 *
 * Reads the session cookie from `req.cookies` when an upstream cookie
 * parser is present; otherwise parses `req.headers.cookie` directly, so
 * no cookie parser is required upstream.
 *
 * @example
 * ```ts
 * import { session } from '@forinda/kickjs'
 *
 * bootstrap({
 *   modules,
 *   middlewares: [
 *     session({ secret: process.env.SESSION_SECRET! }),
 *     // ... other middleware
 *   ],
 * })
 * ```
 */
export function session(options: SessionOptions) {
  if (options.store === 'cookie') return cookieSession(options)
  const {
    cookieName = 'kick.sid',
    maxAge = 86_400_000,
    rolling = false,
    saveUninitialized = true,
    cookie: cookieOpts = {},
  } = options
  const secrets = secretList(options.secret)
  const secret = secrets[0]
  const store = (options.store as SessionStore | undefined) ?? new MemoryStore()

  const cookieDefaults = {
    httpOnly: cookieOpts.httpOnly ?? true,
    secure: cookieOpts.secure ?? isProduction(),
    sameSite: cookieOpts.sameSite ?? ('lax' as const),
    path: cookieOpts.path ?? '/',
    ...(cookieOpts.domain ? { domain: cookieOpts.domain } : {}),
    maxAge,
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    let cookies = (req as any).cookies as Record<string, string> | undefined
    if (!cookies) {
      const header = req.headers.cookie
      cookies = header ? parseCookieHeader(header) : {}
    }
    const signedCookie = cookies[cookieName]
    let sid: string | false = false
    let sessionData: SessionData | null = null
    let isNew = false
    let staleSignature = false

    // Attempt to recover existing session
    if (signedCookie) {
      const unsigned = unsign(signedCookie, secrets)
      if (unsigned) {
        sid = unsigned.value
        staleSignature = unsigned.stale
        sessionData = await store.get(sid)
      }
    }

    // Create new session if none found
    if (!sid || !sessionData) {
      sid = randomUUID()
      sessionData = {}
      isNew = true
    }

    let currentSid = sid
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
        setCookie(res, cookieName, sign(currentSid, secret), cookieDefaults)
      },

      async destroy() {
        await store.destroy(currentSid)
        destroyed = true
        currentData = {}
        sessionObj.data = currentData
        // Expire the cookie the same way it was set — `res.clearCookie` is
        // Express-only and threw under Fastify and h3.
        setCookie(res, cookieName, '', { ...cookieDefaults, maxAge: 0, expires: new Date(0) })
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
      setCookie(res, cookieName, sign(currentSid, secret), cookieDefaults)
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

    // Rolling refreshes the cookie on every response; a cookie signed with an
    // older secret is re-signed with the current one.
    if (!isNew && (rolling || staleSignature)) {
      setCookie(res, cookieName, sign(currentSid, secret), cookieDefaults)
    }

    next()
  }
}

// ── Cookie store ──────────────────────────────────────────────────────

const cookieLog = createLogger('Session')

/** Browsers drop a cookie larger than 4096 bytes, name and attributes included. */
const COOKIE_LIMIT = 4000

interface CookiePayload {
  /** Session id. */
  i: string
  d: SessionData
  /** Expiry, ms since epoch. */
  e: number
}

/**
 * AES-256-GCM, with the cookie name as associated data: `v1.<iv|tag|ciphertext>`.
 * Seals with the first secret's key; opens with any of them.
 */
function sealer(secrets: string[], cookieName: string) {
  const keys = secrets.map((secret) =>
    Buffer.from(hkdfSync('sha256', secret, 'kick.session', 'cookie-store-v1', 32)),
  )
  const key = keys[0]
  const aad = Buffer.from(cookieName)
  return {
    seal(payload: CookiePayload): string {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(aad)
      const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
      return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`
    },
    /**
     * The payload and whether an older secret's key opened it, or null for
     * anything forged, altered, expired or malformed.
     */
    open(value: string): { payload: CookiePayload; stale: boolean } | null {
      if (!value.startsWith('v1.')) return null
      let raw: Buffer
      try {
        raw = Buffer.from(value.slice(3), 'base64url')
      } catch {
        return null
      }
      if (raw.length < 29) return null
      for (const [index, k] of keys.entries()) {
        try {
          const decipher = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12))
            .setAAD(aad)
            .setAuthTag(raw.subarray(12, 28))
          const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
          const payload = JSON.parse(json.toString('utf8')) as CookiePayload
          if (typeof payload?.i !== 'string' || typeof payload.e !== 'number') return null
          if (!payload.d || typeof payload.d !== 'object') return null
          return payload.e > Date.now() ? { payload, stale: index > 0 } : null
        } catch {
          // Not this key (the auth tag fails) — try the next.
        }
      }
      return null
    },
  }
}

type HeaderWriter = (...args: unknown[]) => unknown

/**
 * `session({ store: 'cookie' })`. The cookie is written as late as possible —
 * just before the response's headers go out — so every change made while
 * handling the request is in it, nested ones included. `save()` writes it
 * straight away, for code that redirects right after.
 */
function cookieSession(options: SessionOptions) {
  const {
    cookieName = 'kick.sid',
    maxAge = 86_400_000,
    rolling = false,
    saveUninitialized = true,
    cookie: cookieOpts = {},
  } = options
  const { seal, open } = sealer(secretList(options.secret), cookieName)
  const cookieDefaults = {
    httpOnly: cookieOpts.httpOnly ?? true,
    secure: cookieOpts.secure ?? isProduction(),
    sameSite: cookieOpts.sameSite ?? ('lax' as const),
    path: cookieOpts.path ?? '/',
    ...(cookieOpts.domain ? { domain: cookieOpts.domain } : {}),
  }
  let warnedSize = false

  return (req: Request, res: Response, next: NextFunction) => {
    let cookies = (req as any).cookies as Record<string, string> | undefined
    if (!cookies) {
      const header = req.headers.cookie
      cookies = header ? parseCookieHeader(header) : {}
    }
    const opened = cookies[cookieName] ? open(cookies[cookieName]) : null
    const existing = opened?.payload ?? null
    const isNew = !existing

    let id = existing?.i ?? randomUUID()
    let destroyed = false
    // What the browser already holds, to skip rewriting an unchanged cookie.
    // A cookie sealed with an older secret counts as nothing held, so it is
    // rewritten with the current one.
    let written = existing && !opened?.stale ? JSON.stringify(existing.d) : undefined

    const write = (force = false) => {
      if (res.headersSent) return
      if (destroyed) {
        replaceCookie(res, cookieName, '', { ...cookieDefaults, maxAge: 0, expires: new Date(0) })
        return
      }
      const json = JSON.stringify(sessionObj.data)
      // Unchanged: leave the browser's copy, unless `rolling` renews it.
      if (json === written && !force && !(rolling && !isNew)) return
      // A new, empty session gets a cookie only with saveUninitialized.
      if (written === undefined && json === '{}' && !saveUninitialized && !force) return
      const value = seal({ i: id, d: sessionObj.data, e: Date.now() + maxAge })
      if (value.length + cookieName.length > COOKIE_LIMIT && !warnedSize) {
        warnedSize = true
        cookieLog.warn(
          `session cookie is ${value.length} bytes; browsers drop cookies over 4 KB, ` +
            'so this session will not be kept. Store less in it, or use a shared store.',
        )
      }
      replaceCookie(res, cookieName, value, { ...cookieDefaults, maxAge })
      written = json
    }

    // Just before the headers go out, on whichever call sends them first —
    // Node responses go through writeHead; the web driver's buffered end()
    // does not.
    for (const method of ['writeHead', 'flushHeaders', 'write', 'end'] as const) {
      const original = (res as unknown as Record<string, HeaderWriter | undefined>)[method]
      if (typeof original !== 'function') continue
      ;(res as unknown as Record<string, HeaderWriter>)[method] = function (
        this: unknown,
        ...args: unknown[]
      ) {
        write()
        return original.apply(this, args)
      }
    }

    // h3 called through fetch hands middleware a stand-in response whose
    // headers join the route's response after `finish` — the last chance there.
    // On a Node response `finish` comes after the headers, so this is a no-op.
    ;(res as unknown as { on?: (event: string, fn: () => void) => unknown }).on?.('finish', () =>
      write(),
    )

    const sessionObj: Session = {
      get id() {
        return id
      },
      data: existing ? { ...existing.d } : {},
      async regenerate() {
        id = randomUUID()
        sessionObj.data = {}
        written = undefined
        write(true)
      },
      async destroy() {
        destroyed = true
        sessionObj.data = {}
        write()
      },
      async save() {
        write()
      },
    }
    ;(req as any).session = sessionObj
    next()
  }
}
