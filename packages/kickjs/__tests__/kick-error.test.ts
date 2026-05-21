import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KickError, formatKickError } from '../src/core/kick-error'
import {
  noProviderError,
  requestScopeMiddlewareMissingError,
  requestScopeOutsideRequestError,
  envValueMissingError,
  moduleRouteMissingControllerError,
} from '../src/core/kick-errors'

// ── KickError class ───────────────────────────────────────────────────

describe('KickError', () => {
  it('is an Error subclass', () => {
    const err = new KickError({ code: 'TEST001', summary: 'test' })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(KickError)
  })

  it('preserves code, summary, cause, fix, docsUrl, context as readonly props', () => {
    const err = new KickError({
      code: 'TEST001',
      summary: 'test',
      cause: 'because',
      fix: 'do this',
      docsUrl: 'https://example.com',
      context: { foo: 'bar' },
    })
    expect(err.code).toBe('TEST001')
    expect(err.summary).toBe('test')
    expect(err.cause).toBe('because')
    expect(err.fix).toBe('do this')
    expect(err.docsUrl).toBe('https://example.com')
    expect(err.context).toEqual({ foo: 'bar' })
  })

  it('`.message` contains the plain-text formatted body (no ANSI)', () => {
    const err = new KickError({
      code: 'TEST001',
      summary: 'No widgets available',
      cause: 'You requested a widget but no widgets are registered.',
      fix: 'Register one via `Container.register(WIDGET, ...)`',
    })
    expect(err.message).toContain('TEST001')
    expect(err.message).toContain('No widgets available')
    expect(err.message).toContain('Cause:')
    expect(err.message).toContain('Fix:')
    expect(err.message).not.toMatch(/\x1b\[/) // no ANSI escapes
  })

  it("omits a section when its field isn't provided", () => {
    const err = new KickError({ code: 'TEST001', summary: 'just summary' })
    expect(err.message).not.toContain('Cause:')
    expect(err.message).not.toContain('Fix:')
    expect(err.message).not.toContain('Docs:')
  })
})

// ── formatKickError ────────────────────────────────────────────────────

describe('formatKickError', () => {
  beforeEach(() => {
    delete process.env.NO_COLOR
    delete process.env.FORCE_COLOR
  })

  it('renders a multi-line layout with Cause/Fix/Docs sections in order', () => {
    const out = formatKickError(
      {
        code: 'TEST001',
        summary: 'thing failed',
        cause: 'because reasons',
        fix: 'fix it like this',
        docsUrl: 'https://forinda.github.io/kick-js/guide/x',
      },
      { color: false },
    )
    const causeIdx = out.indexOf('Cause:')
    const fixIdx = out.indexOf('Fix:')
    const docsIdx = out.indexOf('Docs:')
    expect(causeIdx).toBeGreaterThan(-1)
    expect(fixIdx).toBeGreaterThan(causeIdx)
    expect(docsIdx).toBeGreaterThan(fixIdx)
  })

  it('emits ANSI codes when `color: true`', () => {
    const out = formatKickError({ code: 'TEST', summary: 'x' }, { color: true })
    expect(out).toMatch(/\x1b\[/)
  })

  it('emits NO ANSI codes when `color: false`', () => {
    const out = formatKickError(
      { code: 'TEST', summary: 'x', cause: 'y', fix: 'z' },
      { color: false },
    )
    expect(out).not.toMatch(/\x1b\[/)
  })

  it('honors NO_COLOR env var when `color` is unspecified', () => {
    process.env.NO_COLOR = '1'
    const out = formatKickError({ code: 'TEST', summary: 'x' })
    expect(out).not.toMatch(/\x1b\[/)
  })

  it('honors FORCE_COLOR env var when `color` is unspecified', () => {
    process.env.FORCE_COLOR = '1'
    const out = formatKickError({ code: 'TEST', summary: 'x', cause: 'y' })
    expect(out).toMatch(/\x1b\[/)
  })

  afterEach(() => {
    delete process.env.NO_COLOR
    delete process.env.FORCE_COLOR
  })
})

// ── catalog factories ─────────────────────────────────────────────────

describe('kick-errors catalog', () => {
  it('noProviderError — KICK001 with token in summary and context', () => {
    const err = noProviderError('UserService')
    expect(err.code).toBe('KICK001')
    expect(err.summary).toContain('UserService')
    expect(err.context).toEqual({ token: 'UserService' })
    expect(err.fix).toContain('bootstrap')
    expect(err.docsUrl).toContain('dependency-injection')
  })

  it('requestScopeMiddlewareMissingError — KICK002', () => {
    const err = requestScopeMiddlewareMissingError('UserService')
    expect(err.code).toBe('KICK002')
    expect(err.summary).toContain('REQUEST-scoped')
    expect(err.context).toEqual({ token: 'UserService' })
  })

  it('requestScopeOutsideRequestError — KICK003', () => {
    const err = requestScopeOutsideRequestError('UserService')
    expect(err.code).toBe('KICK003')
    expect(err.summary).toContain('outside an HTTP request')
  })

  it('envValueMissingError — KICK004 with envKey in summary, fix mentions the wiring footgun', () => {
    const err = envValueMissingError('DATABASE_URL')
    expect(err.code).toBe('KICK004')
    expect(err.summary).toContain('DATABASE_URL')
    expect(err.fix).toContain("import './env'")
    expect(err.context).toEqual({ envKey: 'DATABASE_URL' })
  })

  it('moduleRouteMissingControllerError — KICK005 with mount path', () => {
    const err = moduleRouteMissingControllerError('/api/users')
    expect(err.code).toBe('KICK005')
    expect(err.summary).toContain('/api/users')
    expect(err.fix).toContain('controller:')
    expect(err.fix).toContain('router:')
  })

  it('all catalog errors include a docsUrl', () => {
    const errs = [
      noProviderError('X'),
      requestScopeMiddlewareMissingError('X'),
      requestScopeOutsideRequestError('X'),
      envValueMissingError('X'),
      moduleRouteMissingControllerError('/x'),
    ]
    for (const e of errs) {
      expect(e.docsUrl).toBeDefined()
      expect(e.docsUrl).toMatch(/^https:\/\//)
    }
  })

  it('codes are unique across the catalog (no duplicates)', () => {
    const codes = new Set<string>()
    const errs = [
      noProviderError('X'),
      requestScopeMiddlewareMissingError('X'),
      requestScopeOutsideRequestError('X'),
      envValueMissingError('X'),
      moduleRouteMissingControllerError('/x'),
    ]
    for (const e of errs) {
      expect(codes.has(e.code)).toBe(false)
      codes.add(e.code)
    }
  })
})
