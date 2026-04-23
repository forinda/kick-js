import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  autoDetect,
  buildCandidates,
  isKickJsWorkspace,
  probeConnection,
  readEnvPorts,
} from '../src/connection'

describe('probeConnection', () => {
  it('returns ok with parsed health info on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', uptime: 42 }),
    } as Partial<Response>)

    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(true)
    expect(res.baseUrl).toBe('http://localhost:3000/_debug')
    if (res.ok) {
      expect(res.info.status).toBe('healthy')
      expect(res.info.uptime).toBe(42)
    }
  })

  it('classifies 404 as not-found with adapter remediation hint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Partial<Response>)
    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('not-found')
      expect(res.error.message).toContain('kick add devtools')
    }
  })

  it('classifies 401 as unauthorized', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Partial<Response>)
    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('unauthorized')
  })

  it('classifies 403 as unauthorized', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Partial<Response>)
    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('unauthorized')
  })

  it('classifies arbitrary 5xx as http', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502 } as Partial<Response>)
    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('http')
      if (res.error.kind === 'http') expect(res.error.status).toBe(502)
    }
  })

  it('classifies AbortError as timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('timeout')
  })

  it('classifies ECONNREFUSED (cause.code) as refused', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('refused')
      expect(res.error.message).toContain('kick dev')
    }
  })

  it('falls back to unknown for unrecognised errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('something weird'))
    const res = await probeConnection('http://localhost:3000', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('unknown')
  })

  it('trims trailing slashes on serverUrl when building baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', uptime: 1 }),
    } as Partial<Response>)
    const res = await probeConnection('http://localhost:3000/', '/_debug', { fetchImpl: fetchImpl as never })
    expect(res.baseUrl).toBe('http://localhost:3000/_debug')
  })
})

describe('autoDetect', () => {
  it('returns null for empty candidate list', async () => {
    const res = await autoDetect([])
    expect(res).toBeNull()
  })

  it('returns the first ok result', async () => {
    let call = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } })
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy', uptime: 5 }),
      } as Partial<Response>
    })
    const res = await autoDetect(
      [
        { serverUrl: 'http://localhost:3000', debugPath: '/_debug' },
        { serverUrl: 'http://localhost:3001', debugPath: '/_debug' },
      ],
      { fetchImpl: fetchImpl as never },
    )
    expect(res?.ok).toBe(true)
  })

  it('returns null when no candidate succeeds', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }))
    const res = await autoDetect(
      [
        { serverUrl: 'http://localhost:3000', debugPath: '/_debug' },
        { serverUrl: 'http://localhost:3001', debugPath: '/_debug' },
      ],
      { fetchImpl: fetchImpl as never },
    )
    expect(res).toBeNull()
  })
})

describe('readEnvPorts + buildCandidates + isKickJsWorkspace', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kick-vscode-conn-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('parses PORT from .env files', () => {
    writeFileSync(join(dir, '.env'), 'PORT=4567\nDATABASE_URL=foo')
    writeFileSync(join(dir, '.env.development'), 'PORT="4001"')
    expect(readEnvPorts(dir).sort()).toEqual([4001, 4567])
  })

  it('returns [] for unreadable directory', () => {
    expect(readEnvPorts('/this/does/not/exist')).toEqual([])
  })

  it('buildCandidates puts env-derived ports first then standard fallbacks', () => {
    writeFileSync(join(dir, '.env'), 'PORT=4567')
    const candidates = buildCandidates([dir])
    expect(candidates[0].serverUrl).toBe('http://localhost:4567')
    expect(candidates.some((c) => c.serverUrl === 'http://localhost:3000')).toBe(true)
  })

  it('isKickJsWorkspace returns true on kick.config.ts', () => {
    writeFileSync(join(dir, 'kick.config.ts'), '')
    expect(isKickJsWorkspace([dir])).toBe(true)
  })

  it('isKickJsWorkspace returns true on package.json with @forinda/kickjs dep', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@forinda/kickjs': '^4.0.0' } }),
    )
    expect(isKickJsWorkspace([dir])).toBe(true)
  })

  it('isKickJsWorkspace returns false for empty workspace', () => {
    expect(isKickJsWorkspace([dir])).toBe(false)
  })

  it('isKickJsWorkspace tolerates malformed package.json', () => {
    writeFileSync(join(dir, 'package.json'), '{ not valid json')
    expect(isKickJsWorkspace([dir])).toBe(false)
  })
})
