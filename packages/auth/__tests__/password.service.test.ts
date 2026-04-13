import { describe, it, expect } from 'vitest'
import { PasswordService } from '../src/password.service'

describe('PasswordService', () => {
  describe('scrypt (default)', () => {
    const pw = new PasswordService()

    it('hashes and verifies a password', async () => {
      const hash = await pw.hash('correct-horse-battery-staple')
      expect(hash).toMatch(/^\$scrypt\$/)
      expect(await pw.verify(hash, 'correct-horse-battery-staple')).toBe(true)
    })

    it('rejects wrong password', async () => {
      const hash = await pw.hash('my-password')
      expect(await pw.verify(hash, 'wrong-password')).toBe(false)
    })

    it('produces different hashes for the same password (random salt)', async () => {
      const h1 = await pw.hash('same-password')
      const h2 = await pw.hash('same-password')
      expect(h1).not.toBe(h2)
    })

    it('needsRehash returns false for current params', async () => {
      const hash = await pw.hash('test')
      expect(pw.needsRehash(hash)).toBe(false)
    })

    it('needsRehash returns true when cost changes', async () => {
      const hash = await pw.hash('test')
      const pw2 = new PasswordService({ cost: 32768 })
      expect(pw2.needsRehash(hash)).toBe(true)
    })

    it('needsRehash returns true for different algorithm', async () => {
      const hash = await pw.hash('test')
      const pw2 = new PasswordService({ algorithm: 'argon2id' })
      expect(pw2.needsRehash(hash)).toBe(true)
    })
  })

  describe('scrypt with custom params', () => {
    const pw = new PasswordService({ cost: 8192, blockSize: 16, keyLength: 32 })

    it('hashes with custom params and verifies', async () => {
      const hash = await pw.hash('my-password')
      expect(hash).toContain('cost=8192')
      expect(hash).toContain('bs=16')
      expect(hash).toContain('kl=32')
      expect(await pw.verify(hash, 'my-password')).toBe(true)
    })

    it('cross-verifies: default instance can verify custom-param hash', async () => {
      const hash = await pw.hash('my-password')
      const defaultPw = new PasswordService()
      // verify reads params from the hash string itself
      expect(await defaultPw.verify(hash, 'my-password')).toBe(true)
    })
  })

  describe('validate', () => {
    const pw = new PasswordService()

    it('accepts valid password with default policy', () => {
      const result = pw.validate('abcdefgh')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects short password', () => {
      const result = pw.validate('abc')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('at least 8')
    })

    it('rejects too-long password', () => {
      const result = pw.validate('a'.repeat(200))
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('at most 128')
    })

    it('enforces uppercase requirement', () => {
      const result = pw.validate('abcdefgh', { requireUppercase: true })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('uppercase')
    })

    it('enforces lowercase requirement', () => {
      const result = pw.validate('ABCDEFGH', { requireLowercase: true })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('lowercase')
    })

    it('enforces digit requirement', () => {
      const result = pw.validate('abcdefgh', { requireDigit: true })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('digit')
    })

    it('enforces special character requirement', () => {
      const result = pw.validate('abcdefgh', { requireSpecial: true })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('special')
    })

    it('passes all requirements when met', () => {
      const result = pw.validate('Abc123!@#defgh', {
        requireUppercase: true,
        requireLowercase: true,
        requireDigit: true,
        requireSpecial: true,
      })
      expect(result.valid).toBe(true)
    })

    it('collects multiple errors', () => {
      const result = pw.validate('ab', {
        minLength: 8,
        requireUppercase: true,
        requireDigit: true,
      })
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('detectAlgorithm and cross-algo verification', () => {
    it('returns false for unknown hash format', async () => {
      const pw = new PasswordService()
      expect(await pw.verify('not-a-hash', 'password')).toBe(false)
    })

    it('returns false for corrupted scrypt hash', async () => {
      const pw = new PasswordService()
      expect(await pw.verify('$scrypt$invalid', 'password')).toBe(false)
    })
  })
})
