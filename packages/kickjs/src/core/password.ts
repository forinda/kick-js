/**
 * Password hashing with scrypt — salted, memory-hard, and self-describing,
 * so the cost can be raised later and old hashes upgrade on the next login:
 *
 * ```ts
 * const stored = await hashPassword(input)          // at sign-up
 *
 * const { ok, needsRehash } = await verifyPassword(input, user?.passwordHash)
 * if (!ok) throw HttpException.unauthorized()
 * if (needsRehash) await users.update(user.id, { passwordHash: await hashPassword(input) })
 * ```
 *
 * Node only (`node:crypto` scrypt); not part of the web entry.
 *
 * @module @forinda/kickjs/core/password
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/** scrypt cost. Memory per hash is `128 * N * r` bytes. */
export interface PasswordHashOptions {
  /** CPU/memory cost, a power of two. Default `2 ** 14`. */
  N?: number
  /** Block size. Default `8`. */
  r?: number
  /** Parallelism. Default `5`. */
  p?: number
}

// OWASP's scrypt option with 16 MiB per hash (N=2^14, r=8, p=5); Django's
// defaults too. Raising N later marks existing hashes `needsRehash`.
const DEFAULTS = { N: 2 ** 14, r: 8, p: 5 }
const SALT_BYTES = 16
const KEY_BYTES = 64

function derive(password: string, salt: Buffer, cost: Required<PasswordHashOptions>) {
  // What OpenSSL allocates (128 * r * (N + p + 2)), plus slack; `256 * N * r`
  // alone is too little when p is large next to N.
  const options: ScryptOptions = {
    ...cost,
    maxmem: 128 * cost.r * (cost.N + cost.p + 2) + 1024 * 1024,
  }
  return new Promise<Buffer>((resolve, reject) =>
    // NFKC, as NIST 800-63B suggests: the same password typed on another
    // keyboard or OS (composed vs decomposed accents) still matches.
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  )
}

function costOf(options: PasswordHashOptions): Required<PasswordHashOptions> {
  const cost = { ...DEFAULTS, ...options }
  if (!Number.isInteger(Math.log2(cost.N)) || cost.N < 2) {
    throw new Error('hashPassword: N must be a power of two')
  }
  return cost
}

/**
 * Hash a password for storage: `scrypt$N$r$p$salt$hash`, salt and hash in
 * base64. The same password hashes differently every time.
 */
export async function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): Promise<string> {
  const cost = costOf(options)
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, cost)
  const encoded = [salt, key].map((bytes) => bytes.toString('base64'))
  return ['scrypt', cost.N, cost.r, cost.p, ...encoded].join('$')
}

/** What {@link verifyPassword} returns. */
export interface PasswordCheck {
  /** The password matches. */
  ok: boolean
  /**
   * The hash was made with a different cost than `options` (the defaults):
   * hash the password again and store it. Only ever true when `ok` is.
   */
  needsRehash: boolean
}

/**
 * A hash format from before scrypt — bcrypt or argon2 rows imported from
 * another system. It still verifies; on success `needsRehash` is true, so the
 * account moves to scrypt at its next login.
 *
 * ```ts
 * import bcrypt from 'bcrypt'
 * const bcryptHashes: LegacyHasher = {
 *   matches: (stored) => /^\$2[aby]\$/.test(stored),
 *   verify: (password, stored) => bcrypt.compare(password, stored),
 *   dummy: await bcrypt.hash('dummy', 12), // the cost your rows use
 * }
 * await verifyPassword(input, user?.passwordHash, { legacy: [bcryptHashes] })
 * ```
 */
export interface LegacyHasher {
  /** Whether `stored` is in this format — by prefix (`$2b$` for bcrypt, `$argon2id$`). */
  matches(stored: string): boolean
  /** Whether `password` matches `stored`: the library's own check. */
  verify(password: string, stored: string): boolean | Promise<boolean>
  /**
   * A hash in this format, of any password, at the cost the rows it
   * `matches` use. Every check runs scrypt once and each legacy hasher once —
   * against this when the account isn't in its format — so a login takes as
   * long for a scrypt account, an imported one or a missing one, and timing
   * can't tell them apart. Rows at several costs: one hasher per cost, each
   * matching its own (bcrypt's `$2b$10$` vs `$2b$12$`) with a dummy at that
   * cost; every login then runs all of them and takes the slowest's time.
   */
  dummy: string
}

/** {@link verifyPassword}'s options: the scrypt cost, and older formats that still verify. */
export interface VerifyPasswordOptions extends PasswordHashOptions {
  /** Formats besides scrypt, tried in order on a hash scrypt can't read. */
  legacy?: readonly LegacyHasher[]
}

// What a missing user is checked against: the same work as a real check.
const DUMMY_SALT = randomBytes(SALT_BYTES)

/**
 * Check a password against a stored hash. Constant-time, and pass
 * `undefined` for a user that doesn't exist: the password is still hashed,
 * so a missing account takes as long to reject as a wrong password and the
 * timing doesn't reveal which accounts exist. A hash not in this format
 * (another algorithm, or corrupt) fails rather than throws, unless one of
 * `options.legacy` reads it.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
  options: VerifyPasswordOptions = {},
): Promise<PasswordCheck> {
  const { legacy = [], ...scryptCost } = options
  const parsed = stored ? parse(stored) : undefined
  const older = !parsed && stored ? legacy.find((hasher) => matches(hasher, stored)) : undefined
  // The same work on every path: scrypt once, and each legacy hasher once —
  // on its dummy unless the account is in its format.
  const [scrypt, checks] = await Promise.all([
    // Costs OpenSSL still refuses (N >= 2^(16r) with a small r) fail, not throw.
    parsed
      ? derive(password, parsed.salt, parsed.cost).catch(() => undefined)
      : derive(password, DUMMY_SALT, costOf(scryptCost)),
    Promise.all(
      legacy.map((hasher) => check(hasher, password, hasher === older ? stored! : hasher.dummy)),
    ),
  ])
  if (older) {
    const ok = checks[legacy.indexOf(older)]!
    return { ok, needsRehash: ok }
  }
  // No such user, or a hash nobody here reads: the work is done, and it fails.
  if (!parsed || !scrypt) return { ok: false, needsRehash: false }
  const ok = scrypt.length === parsed.key.length && timingSafeEqual(scrypt, parsed.key)
  const wanted = costOf(scryptCost)
  const needsRehash =
    ok && (parsed.cost.N !== wanted.N || parsed.cost.r !== wanted.r || parsed.cost.p !== wanted.p)
  return { ok, needsRehash }
}

/** Whether `hasher` reads `stored`; a matcher that throws on a malformed row doesn't. */
function matches(hasher: LegacyHasher, stored: string): boolean {
  try {
    return hasher.matches(stored) === true
  } catch {
    return false
  }
}

/** A legacy hasher's verdict: only `true` is a match; a throw (a malformed row) is not. */
function check(hasher: LegacyHasher, password: string, hash: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => hasher.verify(password, hash))
    .then(
      (result) => result === true,
      () => false,
    )
}

function parse(stored: string) {
  const [algorithm, N, r, pp, salt, key] = stored.split('$')
  if (algorithm !== 'scrypt' || key === undefined) return undefined
  const cost = { N: Number(N), r: Number(r), p: Number(pp) }
  // A hash from elsewhere can't make verification allocate gigabytes: at most
  // 256 MiB (128 * N * r), sixteen times the default.
  if (
    !Number.isInteger(Math.log2(cost.N)) ||
    cost.N < 2 ||
    !Number.isInteger(cost.r) ||
    cost.r < 1 ||
    cost.r > 32 ||
    !Number.isInteger(cost.p) ||
    cost.p < 1 ||
    cost.p > 16 ||
    128 * cost.N * cost.r > 2 ** 28
  ) {
    return undefined
  }
  return { cost, salt: Buffer.from(salt, 'base64'), key: Buffer.from(key, 'base64') }
}
