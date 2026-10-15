/**
 * Signed, timestamped tokens — a password-reset link, an unsubscribe link,
 * an email-confirmation code — that the server can verify later without
 * storing them:
 *
 * ```ts
 * const resets = createSigner({ secret: process.env.SIGNING_SECRET!, salt: 'password-reset' })
 *
 * const token = resets.sign({ userId: user.id })                 // put it in the link
 * const check = resets.verify<{ userId: string }>(token, { maxAge: 60 * 60_000 })
 * if (!check.ok) throw HttpException.badRequest(check.reason)           // 'invalid' | 'expired'
 * ```
 *
 * The value is signed, not encrypted: anyone holding the token can read it.
 * Node only (`node:crypto` HMAC); not part of the web entry.
 *
 * @module @forinda/kickjs/core/signing
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SignerOptions {
  /**
   * The signing secret. Pass a list to rotate: the first signs, every one
   * verifies. Drop the old one once its tokens have expired.
   */
  secret: string | string[]
  /**
   * What the tokens are for — `'password-reset'`, `'unsubscribe'`. Signers
   * with different salts reject each other's tokens even with the same
   * secret, so a token issued for one purpose can't be used for another.
   */
  salt: string
}

export interface VerifyOptions {
  /** Reject tokens older than this, in milliseconds. */
  maxAge?: number
}

/** What {@link Signer.verify} returns. */
export type SignedCheck<T> =
  | { ok: true; value: T; issuedAt: Date }
  | { ok: false; reason: 'invalid' | 'expired' }

export interface Signer {
  /** Sign a JSON-serialisable value: `payload.timestamp.signature`, URL-safe. */
  sign(value: unknown): string
  /** Check a token's signature and, with `maxAge`, its age. Never throws. */
  verify<T = unknown>(token: string, options?: VerifyOptions): SignedCheck<T>
}

/** Create a signer for one purpose. */
export function createSigner(options: SignerOptions): Signer {
  const secrets = Array.isArray(options.secret) ? options.secret : [options.secret]
  if (secrets.length === 0 || secrets.some((s) => typeof s !== 'string' || s.length === 0)) {
    throw new Error('createSigner: `secret` must be a non-empty string or list of strings')
  }
  if (!options.salt) throw new Error('createSigner: `salt` names what the tokens are for')
  // One key per secret and purpose, so the raw secret never signs directly.
  const keys = secrets.map((secret) =>
    createHmac('sha256', secret).update(`kickjs.signing:${options.salt}`).digest(),
  )
  const mac = (key: Buffer, data: string) =>
    createHmac('sha256', key).update(data).digest('base64url')

  return {
    sign(value) {
      const json = JSON.stringify(value)
      if (json === undefined) throw new Error('signer.sign: the value must be JSON-serialisable')
      const payload = Buffer.from(json).toString('base64url')
      const signed = `${payload}.${Date.now().toString(36)}`
      return `${signed}.${mac(keys[0], signed)}`
    },
    verify<T>(token: string, verifyOptions: VerifyOptions = {}): SignedCheck<T> {
      const invalid = { ok: false, reason: 'invalid' } as const
      if (typeof token !== 'string') return invalid
      const cut = token.lastIndexOf('.')
      const signed = token.slice(0, cut)
      const signature = Buffer.from(token.slice(cut + 1))
      const [payload, stamp, extra] = signed.split('.')
      if (cut < 0 || stamp === undefined || extra !== undefined) return invalid
      const matches = keys.some((key) => {
        const expected = Buffer.from(mac(key, signed))
        return expected.length === signature.length && timingSafeEqual(expected, signature)
      })
      if (!matches) return invalid
      const issued = parseInt(stamp, 36)
      if (!Number.isFinite(issued)) return invalid
      if (verifyOptions.maxAge !== undefined && Date.now() - issued > verifyOptions.maxAge) {
        return { ok: false, reason: 'expired' }
      }
      try {
        const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as T
        return { ok: true, value, issuedAt: new Date(issued) }
      } catch {
        return invalid
      }
    },
  }
}
