import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
// ── In-Memory Store ───────────────────────────────────────────────────
class MemoryStore {
    sessions = new Map();
    cleanupInterval;
    constructor() {
        // Purge expired sessions every 60 seconds
        this.cleanupInterval = setInterval(() => this.purge(), 60_000);
        this.cleanupInterval.unref();
    }
    async get(sid) {
        const entry = this.sessions.get(sid);
        if (!entry)
            return null;
        if (Date.now() > entry.expires) {
            this.sessions.delete(sid);
            return null;
        }
        return entry.data;
    }
    async set(sid, data, maxAge) {
        this.sessions.set(sid, { data, expires: Date.now() + maxAge });
    }
    async destroy(sid) {
        this.sessions.delete(sid);
    }
    async touch(sid, maxAge) {
        const entry = this.sessions.get(sid);
        if (entry) {
            entry.expires = Date.now() + maxAge;
        }
    }
    purge() {
        const now = Date.now();
        for (const [sid, entry] of this.sessions) {
            if (now > entry.expires) {
                this.sessions.delete(sid);
            }
        }
    }
}
// ── Cookie Signing ────────────────────────────────────────────────────
function sign(value, secret) {
    const signature = createHmac('sha256', secret).update(value).digest('base64url');
    return `s:${value}.${signature}`;
}
function unsign(signed, secret) {
    if (!signed.startsWith('s:'))
        return false;
    const raw = signed.slice(2);
    const dotIndex = raw.lastIndexOf('.');
    if (dotIndex === -1)
        return false;
    const value = raw.slice(0, dotIndex);
    const providedSig = raw.slice(dotIndex + 1);
    const expectedSig = createHmac('sha256', secret).update(value).digest('base64url');
    const a = Buffer.from(providedSig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return false;
    }
    return value;
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
export function session(options) {
    const { secret, cookieName = 'kick.sid', maxAge = 86_400_000, rolling = false, saveUninitialized = true, store = new MemoryStore(), cookie: cookieOpts = {}, } = options;
    const cookieDefaults = {
        httpOnly: cookieOpts.httpOnly ?? true,
        secure: cookieOpts.secure ?? process.env.NODE_ENV === 'production',
        sameSite: cookieOpts.sameSite ?? 'lax',
        path: cookieOpts.path ?? '/',
        ...(cookieOpts.domain ? { domain: cookieOpts.domain } : {}),
        maxAge,
    };
    return async (req, res, next) => {
        const cookies = req.cookies || {};
        const signedCookie = cookies[cookieName];
        let sid = false;
        let sessionData = null;
        let isNew = false;
        // Attempt to recover existing session
        if (signedCookie) {
            sid = unsign(signedCookie, secret);
            if (sid) {
                sessionData = await store.get(sid);
            }
        }
        // Create new session if none found
        if (!sid || !sessionData) {
            sid = randomUUID();
            sessionData = {};
            isNew = true;
        }
        let currentSid = sid;
        let currentData = { ...sessionData };
        let destroyed = false;
        const sessionObj = {
            get id() {
                return currentSid;
            },
            data: currentData,
            async regenerate() {
                await store.destroy(currentSid);
                currentSid = randomUUID();
                currentData = {};
                sessionObj.data = currentData;
                await store.set(currentSid, currentData, maxAge);
                res.cookie(cookieName, sign(currentSid, secret), cookieDefaults);
            },
            async destroy() {
                await store.destroy(currentSid);
                destroyed = true;
                currentData = {};
                sessionObj.data = currentData;
                res.clearCookie(cookieName, { path: cookieDefaults.path });
            },
            async save() {
                if (!destroyed) {
                    await store.set(currentSid, currentData, maxAge);
                }
            },
        };
        req.session = sessionObj;
        // Set cookie for new sessions
        if (isNew) {
            res.cookie(cookieName, sign(currentSid, secret), cookieDefaults);
        }
        // Auto-save on response finish
        res.on('finish', async () => {
            if (destroyed)
                return;
            if (isNew && !saveUninitialized && Object.keys(currentData).length === 0)
                return;
            await store.set(currentSid, currentData, maxAge);
            if (rolling && !isNew) {
                if (store.touch) {
                    await store.touch(currentSid, maxAge);
                }
            }
        });
        // Rolling: refresh cookie on every response
        if (rolling && !isNew) {
            res.cookie(cookieName, sign(currentSid, secret), cookieDefaults);
        }
        next();
    };
}
//# sourceMappingURL=session.js.map