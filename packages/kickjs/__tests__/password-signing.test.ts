import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createSigner, hashPassword, verifyPassword, type LegacyHasher } from '../src/index'

// Cheap cost for tests; the defaults are exercised once below.
const fast = { N: 2 ** 10, r: 8, p: 1 }

describe('hashPassword / verifyPassword', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse', fast)
    expect(stored).toMatch(/^scrypt\$1024\$8\$1\$[\w+/=]+\$[\w+/=]+$/)
    expect(await verifyPassword('correct horse', stored, fast)).toEqual({
      ok: true,
      needsRehash: false,
    })
    expect(await verifyPassword('wrong horse', stored, fast)).toEqual({
      ok: false,
      needsRehash: false,
    })
  })

  it('salts: the same password hashes differently each time', async () => {
    expect(await hashPassword('pw', fast)).not.toBe(await hashPassword('pw', fast))
  })

  it('asks for a rehash when the cost changed, only on a match', async () => {
    const stored = await hashPassword('pw', fast)
    expect(await verifyPassword('pw', stored)).toEqual({ ok: true, needsRehash: true })
    expect(await verifyPassword('nope', stored)).toEqual({ ok: false, needsRehash: false })
  })

  it('uses the default cost when none is given', async () => {
    const stored = await hashPassword('pw')
    expect(stored.startsWith('scrypt$16384$8$5$')).toBe(true)
    expect(await verifyPassword('pw', stored)).toEqual({ ok: true, needsRehash: false })
  })

  it('treats composed and decomposed accents as the same password', async () => {
    const stored = await hashPassword('café', fast)
    expect((await verifyPassword('café', stored, fast)).ok).toBe(true)
  })

  it('fails, without throwing, for a missing user or a foreign or hostile hash', async () => {
    for (const stored of [
      undefined,
      null,
      '',
      '$2b$10$abcdefghijklmnopqrstuv', // bcrypt
      'scrypt$1048577$8$1$c2FsdA==$a2V5', // N not a power of two
      'scrypt$4194304$8$1$c2FsdA==$a2V5', // 4 GiB
      'scrypt$1048576$32$1$c2FsdA==$a2V5', // 4 GiB through r
    ]) {
      expect(await verifyPassword('pw', stored, fast)).toEqual({ ok: false, needsRehash: false })
    }
  })

  it('handles a large p next to a small N, and fails on a cost OpenSSL refuses', async () => {
    const stored = await hashPassword('pw', { N: 2, r: 1, p: 16 })
    expect((await verifyPassword('pw', stored, { N: 2, r: 1, p: 16 })).ok).toBe(true)
    const refused = `scrypt$${2 ** 21}$1$1$c2FsdA==$a2V5`
    expect(await verifyPassword('pw', refused)).toEqual({ ok: false, needsRehash: false })
  })

  it('checks a missing user at the configured cost, not the default', async () => {
    // The dummy check reads `options`: an invalid cost surfaces from it too.
    await expect(verifyPassword('pw', undefined, { N: 1000 })).rejects.toThrow(/power of two/)
  })

  it('rejects a cost that is not a power of two', async () => {
    await expect(hashPassword('pw', { N: 1000 })).rejects.toThrow(/power of two/)
  })
})

describe('verifyPassword with legacy formats', () => {
  // A stand-in for bcrypt: `sha256$<hex>`.
  const sha: LegacyHasher = {
    matches: (stored) => stored.startsWith('sha256$'),
    verify: (password, stored) =>
      stored === `sha256$${createHash('sha256').update(password).digest('hex')}`,
  }
  const old = `sha256$${createHash('sha256').update('hunter2').digest('hex')}`

  it('verifies an imported hash and asks for a rehash, so the account moves to scrypt', async () => {
    expect(await verifyPassword('hunter2', old, { ...fast, legacy: [sha] })).toEqual({
      ok: true,
      needsRehash: true,
    })
    expect(await verifyPassword('wrong', old, { ...fast, legacy: [sha] })).toEqual({
      ok: false,
      needsRehash: false,
    })
  })

  it('fails without the hasher, and when it throws or returns something other than true', async () => {
    expect((await verifyPassword('hunter2', old, fast)).ok).toBe(false)
    const throws: LegacyHasher = {
      matches: () => true,
      verify: () => {
        throw new Error('malformed hash')
      },
    }
    expect((await verifyPassword('hunter2', old, { ...fast, legacy: [throws] })).ok).toBe(false)
    const truthy: LegacyHasher = { matches: () => true, verify: () => 1 as unknown as boolean }
    expect((await verifyPassword('hunter2', old, { ...fast, legacy: [truthy] })).ok).toBe(false)
  })

  it('leaves scrypt hashes to scrypt', async () => {
    const stored = await hashPassword('hunter2', fast)
    const never: LegacyHasher = { matches: () => true, verify: () => true }
    expect(await verifyPassword('wrong', stored, { ...fast, legacy: [never] })).toEqual({
      ok: false,
      needsRehash: false,
    })
  })
})

describe('createSigner', () => {
  afterEach(() => vi.useRealTimers())

  const signer = createSigner({ secret: 'k'.repeat(32), salt: 'password-reset' })

  it('round-trips a value with its issue time', () => {
    const token = signer.sign({ userId: 'u1' })
    expect(token).toMatch(/^[\w-]+\.[0-9a-z]+\.[\w-]+$/)
    const check = signer.verify<{ userId: string }>(token)
    expect(check.ok && check.value).toEqual({ userId: 'u1' })
    expect(check.ok && check.issuedAt).toBeInstanceOf(Date)
  })

  it('rejects a tampered payload, timestamp or signature', () => {
    const [payload, stamp, sig] = signer.sign({ role: 'user' }).split('.')
    const forged = Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')
    for (const token of [
      `${forged}.${stamp}.${sig}`,
      `${payload}.${(parseInt(stamp, 36) + 1).toString(36)}.${sig}`,
      `${payload}.${stamp}.${sig.slice(0, -2)}AA`,
      `${payload}.${stamp}`,
      'garbage',
      '',
    ]) {
      expect(signer.verify(token)).toEqual({ ok: false, reason: 'invalid' })
    }
  })

  it('expires tokens older than maxAge', () => {
    vi.useFakeTimers()
    const token = signer.sign('x')
    vi.advanceTimersByTime(61_000)
    expect(signer.verify(token, { maxAge: 60_000 })).toEqual({ ok: false, reason: 'expired' })
    expect(signer.verify(token, { maxAge: 120_000 }).ok).toBe(true)
  })

  it('keeps purposes apart: another salt rejects the token', () => {
    const other = createSigner({ secret: 'k'.repeat(32), salt: 'unsubscribe' })
    expect(other.verify(signer.sign('x')).ok).toBe(false)
  })

  it('rotates: the old secret still verifies, the new one signs', () => {
    const old = createSigner({ secret: 'old-secret', salt: 's' })
    const rotated = createSigner({ secret: ['new-secret', 'old-secret'], salt: 's' })
    const fresh = createSigner({ secret: 'new-secret', salt: 's' })
    expect(rotated.verify(old.sign(1)).ok).toBe(true)
    expect(fresh.verify(rotated.sign(1)).ok).toBe(true)
    expect(old.verify(rotated.sign(1)).ok).toBe(false)
  })

  it('refuses an empty secret, a missing salt, or a value JSON cannot hold', () => {
    expect(() => createSigner({ secret: '', salt: 's' })).toThrow(/secret/)
    expect(() => createSigner({ secret: [], salt: 's' })).toThrow(/secret/)
    expect(() => createSigner({ secret: 'k', salt: '' })).toThrow(/salt/)
    expect(() => signer.sign(undefined)).toThrow(/JSON/)
  })
})
