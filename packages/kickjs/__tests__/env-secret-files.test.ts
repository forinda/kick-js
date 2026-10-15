import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { getEnv, loadEnv, resetEnvCache } from '../src/index'
import { withSecretFiles } from '../src/config/env'

const dir = mkdtempSync(join(tmpdir(), 'kick-secrets-'))
const secret = (name: string, content: string) => {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

afterEach(() => {
  vi.unstubAllEnvs()
  resetEnvCache()
})

describe('<KEY>_FILE secrets', () => {
  it('reads a declared key from its file, dropping one trailing newline', () => {
    vi.stubEnv('KICK_T_DB_PASSWORD_FILE', secret('db', 'hunter2\n'))
    const env = loadEnv(z.object({ KICK_T_DB_PASSWORD: z.string() }))
    expect(env.KICK_T_DB_PASSWORD).toBe('hunter2')
    expect(getEnv('KICK_T_DB_PASSWORD' as never)).toBe('hunter2')
    // Not copied into process.env, which child processes inherit.
    expect(process.env.KICK_T_DB_PASSWORD).toBeUndefined()
  })

  it('reads several secrets at once, each from its own file', () => {
    vi.stubEnv('KICK_T_DB_PASSWORD_FILE', secret('db_password', 'pg-secret\n'))
    vi.stubEnv('KICK_T_JWT_SECRET_FILE', secret('jwt_secret', 'jwt-secret'))
    vi.stubEnv('KICK_T_STRIPE_KEY_FILE', secret('stripe_key', 'sk_test_123\r\n'))
    // An ordinary variable alongside them still comes from the environment.
    vi.stubEnv('KICK_T_REGION', 'eu-west-1')

    const env = loadEnv(
      z.object({
        KICK_T_DB_PASSWORD: z.string(),
        KICK_T_JWT_SECRET: z.string().min(8),
        KICK_T_STRIPE_KEY: z.string().startsWith('sk_'),
        KICK_T_REGION: z.string(),
      }),
    )
    expect(env).toMatchObject({
      KICK_T_DB_PASSWORD: 'pg-secret',
      KICK_T_JWT_SECRET: 'jwt-secret',
      KICK_T_STRIPE_KEY: 'sk_test_123',
      KICK_T_REGION: 'eu-west-1',
    })
    for (const key of ['KICK_T_DB_PASSWORD', 'KICK_T_JWT_SECRET', 'KICK_T_STRIPE_KEY']) {
      expect(process.env[key]).toBeUndefined()
    }
  })

  it('validates a file-supplied value like any other', () => {
    vi.stubEnv('KICK_T_STRIPE_KEY_FILE', secret('bad_key', 'not-a-key'))
    expect(() => loadEnv(z.object({ KICK_T_STRIPE_KEY: z.string().startsWith('sk_') }))).toThrow()
  })

  it('treats an empty variable as unset, as the official Postgres image does', () => {
    // An empty `DB_PASSWORD=` (a placeholder in a shared .env) is not a second
    // value: the file supplies it. Postgres' entrypoint (file_env) behaves the same.
    const path = secret('empty_case', 'from-file')
    expect(withSecretFiles({ KT_X: '', KT_X_FILE: path }, ['KT_X']).KT_X).toBe('from-file')
  })

  it('leaves undeclared *_FILE variables alone', () => {
    const env = { LOG_FILE: '/var/log/app.log' }
    expect(withSecretFiles(env, ['PORT'])).toBe(env)
  })

  it('refuses a key set both ways, and an unreadable file, without leaking contents', () => {
    vi.stubEnv('KICK_T_TOKEN', 'plain')
    vi.stubEnv('KICK_T_TOKEN_FILE', secret('token', 'from-file'))
    expect(() => loadEnv(z.object({ KICK_T_TOKEN: z.string() }))).toThrow(
      /either KICK_T_TOKEN or KICK_T_TOKEN_FILE, not both/,
    )

    resetEnvCache()
    vi.unstubAllEnvs()
    vi.stubEnv('KICK_T_KEY_FILE', join(dir, 'missing'))
    expect(() => loadEnv(z.object({ KICK_T_KEY: z.string() }))).toThrow(
      /KICK_T_KEY_FILE points at .*missing, which could not be read \(ENOENT\)/,
    )
  })
})
