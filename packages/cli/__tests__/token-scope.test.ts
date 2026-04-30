// Coverage for `resolveTokenScope()` + the per-template threading.
// The function is small but its three-layer fallback (config →
// package.json @scope → bare name → 'app') is the kind of thing that
// breaks subtly under refactor; locking each branch in a test
// catches a regression before adopters do.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { resolveTokenScope } from '../src/config'
import { generateRepositoryInterface } from '../src/generators/templates/repository'

describe('resolveTokenScope', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kick-token-scope-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the explicit kick.config.ts tokenScope when set', () => {
    expect(resolveTokenScope({ tokenScope: 'mycorp' }, dir)).toBe('mycorp')
  })

  it('lowercases + sanitises the explicit scope', () => {
    expect(resolveTokenScope({ tokenScope: 'My Corp!' }, dir)).toBe('my-corp')
  })

  it('falls back to the @scope of an @scope/pkg package name', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@mycorp/billing-api', version: '0.0.0' }),
    )
    expect(resolveTokenScope(null, dir)).toBe('mycorp')
  })

  it('uses the bare package name when not @scope-prefixed', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'billing-api', version: '0.0.0' }),
    )
    expect(resolveTokenScope(null, dir)).toBe('billing-api')
  })

  it('sanitises uppercase + special chars from the package name', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'BillingAPI v2', version: '0.0.0' }),
    )
    // Camel case isn't transformed (we only lowercase + replace
    // non-[a-z0-9-] with '-'). 'BillingAPI v2' → 'billingapi-v2'.
    expect(resolveTokenScope(null, dir)).toBe('billingapi-v2')
  })

  it("falls back to 'app' when no package.json exists", () => {
    expect(resolveTokenScope(null, dir)).toBe('app')
  })

  it("falls back to 'app' when package.json has no name field", () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.0.0' }))
    expect(resolveTokenScope(null, dir)).toBe('app')
  })

  it("falls back to 'app' when package.json is malformed", () => {
    writeFileSync(join(dir, 'package.json'), '{ broken json')
    expect(resolveTokenScope(null, dir)).toBe('app')
  })

  it('config tokenScope wins over package.json name', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@othercorp/billing', version: '0.0.0' }),
    )
    expect(resolveTokenScope({ tokenScope: 'mycorp' }, dir)).toBe('mycorp')
  })

  it('ignores empty-string tokenScope from config and falls through', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@mycorp/x', version: '0.0.0' }),
    )
    expect(resolveTokenScope({ tokenScope: '' }, dir)).toBe('mycorp')
  })
})

describe('generateRepositoryInterface — token-scope substitution', () => {
  it("emits 'app/<kebab>/repository' when tokenScope is omitted", () => {
    const out = generateRepositoryInterface({ pascal: 'User', kebab: 'user' })
    expect(out).toContain(`createToken<IUserRepository>('app/user/repository')`)
  })

  it('emits the resolved scope when tokenScope is set', () => {
    const out = generateRepositoryInterface({
      pascal: 'User',
      kebab: 'user',
      tokenScope: 'mycorp',
    })
    expect(out).toContain(`createToken<IUserRepository>('mycorp/user/repository')`)
    // Documents the 'no kick/' rule inline so adopters reading the
    // file understand why the scope is what it is.
    expect(out).toMatch(/`'mycorp\/'` prefix matches the project scope/)
  })

  it("uses the resolved scope's kebab-case in the token literal", () => {
    const out = generateRepositoryInterface({
      pascal: 'TaskAssignee',
      kebab: 'task-assignee',
      tokenScope: 'billing-api',
    })
    expect(out).toContain(
      `createToken<ITaskAssigneeRepository>('billing-api/task-assignee/repository')`,
    )
  })
})
