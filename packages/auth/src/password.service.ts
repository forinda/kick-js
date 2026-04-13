import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'

function scryptAsync(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

// ── Types ───────────────────────────────────────────────────────────────

export interface PasswordConfig {
  /**
   * Hashing algorithm.
   * - `'scrypt'` — Node.js built-in, zero dependencies (default)
   * - `'argon2id'` — requires `argon2` peer dependency
   * - `'bcrypt'` — requires `bcrypt` peer dependency
   */
  algorithm?: 'argon2id' | 'bcrypt' | 'scrypt'

  // scrypt options
  /** scrypt CPU/memory cost parameter (default: 16384 = 2^14) */
  cost?: number
  /** scrypt block size (default: 8) */
  blockSize?: number
  /** scrypt parallelism (default: 1) */
  parallelism?: number
  /** scrypt derived key length in bytes (default: 64) */
  keyLength?: number

  // argon2 options
  /** argon2 memory cost in KiB (default: 65536 = 64MB) */
  memoryCost?: number
  /** argon2 time cost / iterations (default: 3) */
  timeCost?: number

  // bcrypt options
  /** bcrypt salt rounds (default: 12) */
  rounds?: number

  /** Salt length in bytes for scrypt (default: 16) */
  saltLength?: number
}

export interface PasswordPolicy {
  /** Minimum password length (default: 8) */
  minLength?: number
  /** Maximum password length (default: 128) */
  maxLength?: number
  /** Require at least one uppercase letter */
  requireUppercase?: boolean
  /** Require at least one lowercase letter */
  requireLowercase?: boolean
  /** Require at least one digit */
  requireDigit?: boolean
  /** Require at least one special character */
  requireSpecial?: boolean
}

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

// ── Default config ──────────────────────────────────────────────────────

const DEFAULTS: Required<PasswordConfig> = {
  algorithm: 'scrypt',
  cost: 16384,
  blockSize: 8,
  parallelism: 1,
  keyLength: 64,
  memoryCost: 65536,
  timeCost: 3,
  rounds: 12,
  saltLength: 16,
}

const DEFAULT_POLICY: Required<PasswordPolicy> = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecial: false,
}

// ── Hash format ─────────────────────────────────────────────────────────
//
// scrypt:   $scrypt$cost=16384,bs=8,p=1,kl=64$<salt-hex>$<hash-hex>
// argon2:   native argon2 PHC string (handled by argon2 lib)
// bcrypt:   native bcrypt string (handled by bcrypt lib)

/**
 * Secure password hashing and verification service.
 *
 * Supports scrypt (zero-dep default), argon2id, and bcrypt.
 * Includes timing-safe comparison and rehash detection.
 *
 * @example
 * ```ts
 * const pw = new PasswordService()
 * const hash = await pw.hash('my-password')
 * const valid = await pw.verify(hash, 'my-password')   // true
 * const stale = pw.needsRehash(hash)                    // false (params match)
 * ```
 *
 * @example
 * ```ts
 * // With argon2 (requires `pnpm add argon2`)
 * const pw = new PasswordService({ algorithm: 'argon2id' })
 * ```
 */
export class PasswordService {
  private readonly config: Required<PasswordConfig>

  constructor(config?: PasswordConfig) {
    this.config = { ...DEFAULTS, ...config }
  }

  // ── Hash ────────────────────────────────────────────────────────────

  async hash(password: string): Promise<string> {
    switch (this.config.algorithm) {
      case 'scrypt':
        return this.hashScrypt(password)
      case 'argon2id':
        return this.hashArgon2(password)
      case 'bcrypt':
        return this.hashBcrypt(password)
      default:
        throw new Error(`Unsupported algorithm: ${this.config.algorithm}`)
    }
  }

  // ── Verify ──────────────────────────────────────────────────────────

  async verify(hash: string, password: string): Promise<boolean> {
    const algo = this.detectAlgorithm(hash)

    switch (algo) {
      case 'scrypt':
        return this.verifyScrypt(hash, password)
      case 'argon2id':
        return this.verifyArgon2(hash, password)
      case 'bcrypt':
        return this.verifyBcrypt(hash, password)
      default:
        return false
    }
  }

  // ── Rehash Detection ────────────────────────────────────────────────

  /**
   * Check if a hash was produced with outdated parameters and should
   * be re-hashed on next successful login.
   */
  needsRehash(hash: string): boolean {
    const algo = this.detectAlgorithm(hash)

    if (algo !== this.config.algorithm) return true

    if (algo === 'scrypt') {
      const params = this.parseScryptHash(hash)
      if (!params) return true
      return (
        params.cost !== this.config.cost ||
        params.blockSize !== this.config.blockSize ||
        params.parallelism !== this.config.parallelism ||
        params.keyLength !== this.config.keyLength
      )
    }

    // For argon2/bcrypt, delegate to the library's built-in check or
    // compare the encoded parameters. For now, return false (same algo = OK).
    // A more thorough check can parse the PHC/bcrypt cost from the string.
    if (algo === 'bcrypt') {
      const match = /^\$2[aby]?\$(\d+)\$/.exec(hash)
      if (match) {
        return Number.parseInt(match[1], 10) !== this.config.rounds
      }
    }

    if (algo === 'argon2id') {
      // argon2 PHC format: $argon2id$v=19$m=65536,t=3,p=1$...
      const match = /m=(\d+),t=(\d+)/.exec(hash)
      if (match) {
        return (
          Number.parseInt(match[1], 10) !== this.config.memoryCost ||
          Number.parseInt(match[2], 10) !== this.config.timeCost
        )
      }
    }

    return false
  }

  // ── Validation ──────────────────────────────────────────────────────

  /**
   * Validate a plaintext password against a policy.
   */
  validate(password: string, policy?: PasswordPolicy): PasswordValidationResult {
    const p = { ...DEFAULT_POLICY, ...policy }
    const errors: string[] = []

    if (password.length < p.minLength) {
      errors.push(`Password must be at least ${p.minLength} characters`)
    }
    if (password.length > p.maxLength) {
      errors.push(`Password must be at most ${p.maxLength} characters`)
    }
    if (p.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter')
    }
    if (p.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter')
    }
    if (p.requireDigit && !/\d/.test(password)) {
      errors.push('Password must contain at least one digit')
    }
    if (p.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
      errors.push('Password must contain at least one special character')
    }

    return { valid: errors.length === 0, errors }
  }

  // ── scrypt Implementation ──────────────────────────────────────────

  private async hashScrypt(password: string): Promise<string> {
    const salt = randomBytes(this.config.saltLength)
    const derived = await scryptAsync(password, salt, this.config.keyLength, {
      N: this.config.cost,
      r: this.config.blockSize,
      p: this.config.parallelism,
    })

    const params = `cost=${this.config.cost},bs=${this.config.blockSize},p=${this.config.parallelism},kl=${this.config.keyLength}`
    return `$scrypt$${params}$${salt.toString('hex')}$${derived.toString('hex')}`
  }

  private async verifyScrypt(hash: string, password: string): Promise<boolean> {
    const params = this.parseScryptHash(hash)
    if (!params) return false

    const salt = Buffer.from(params.salt, 'hex')
    const expected = Buffer.from(params.hash, 'hex')

    const derived = await scryptAsync(password, salt, params.keyLength, {
      N: params.cost,
      r: params.blockSize,
      p: params.parallelism,
    })

    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  }

  private parseScryptHash(hash: string) {
    const match = /^\$scrypt\$cost=(\d+),bs=(\d+),p=(\d+),kl=(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(
      hash,
    )
    if (!match) return null
    return {
      cost: Number.parseInt(match[1], 10),
      blockSize: Number.parseInt(match[2], 10),
      parallelism: Number.parseInt(match[3], 10),
      keyLength: Number.parseInt(match[4], 10),
      salt: match[5],
      hash: match[6],
    }
  }

  // ── argon2 Implementation ──────────────────────────────────────────

  private async hashArgon2(password: string): Promise<string> {
    const argon2 = await this.loadArgon2()
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.memoryCost,
      timeCost: this.config.timeCost,
      parallelism: this.config.parallelism,
    })
  }

  private async verifyArgon2(hash: string, password: string): Promise<boolean> {
    const argon2 = await this.loadArgon2()
    return argon2.verify(hash, password)
  }

  private async loadArgon2(): Promise<any> {
    try {
      // @ts-expect-error optional peer dependency
      return await import('argon2')
    } catch {
      throw new Error(
        'PasswordService with algorithm "argon2id" requires the "argon2" package. Install: pnpm add argon2',
      )
    }
  }

  // ── bcrypt Implementation ──────────────────────────────────────────

  private async hashBcrypt(password: string): Promise<string> {
    const bcrypt = await this.loadBcrypt()
    return bcrypt.hash(password, this.config.rounds)
  }

  private async verifyBcrypt(hash: string, password: string): Promise<boolean> {
    const bcrypt = await this.loadBcrypt()
    return bcrypt.compare(password, hash)
  }

  private async loadBcrypt(): Promise<any> {
    // Prefer bcryptjs (pure JS, no native compilation) over bcrypt (native).
    // These are optional peer deps — @ts-expect-error suppresses TS2307.
    try {
      // @ts-expect-error optional peer dependency
      const mod: any = await import('bcryptjs')
      return mod.default ?? mod
    } catch {
      try {
        // @ts-expect-error optional peer dependency
        const mod: any = await import('bcrypt')
        return mod.default ?? mod
      } catch {
        throw new Error(
          'PasswordService with algorithm "bcrypt" requires "bcryptjs" or "bcrypt". Install: pnpm add bcryptjs',
        )
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private detectAlgorithm(hash: string): string {
    if (hash.startsWith('$scrypt$')) return 'scrypt'
    if (hash.startsWith('$argon2')) return 'argon2id'
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$'))
      return 'bcrypt'
    return 'unknown'
  }
}
