/**
 * Unit tests for `validateAssetMap` (PR 1 of assets-plan.md).
 *
 * Validates only — no copy / typegen / runtime behaviour yet. Those
 * arrive in PRs 2–4. Tests focus on the warning surface so we don't
 * regress the "kick g still works when assetMap is misconfigured"
 * contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateAssetMap, type KickConfig } from '../src/config'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'kick-asset-map-'))
})

afterEach(() => {
  try {
    rmSync(cwd, { recursive: true, force: true })
  } catch {
    /* ignore cleanup races */
  }
})

function makeDir(rel: string): void {
  mkdirSync(join(cwd, rel), { recursive: true })
}

describe('validateAssetMap — happy path', () => {
  it('returns no warnings for a valid record', () => {
    makeDir('src/templates/mails')
    makeDir('src/schemas')
    const config: KickConfig = {
      assetMap: {
        mails: { src: 'src/templates/mails' },
        schemas: { src: 'src/schemas', glob: '**/*.json' },
      },
    }
    expect(validateAssetMap(config, cwd)).toEqual([])
  })

  it('returns no warnings when assetMap is omitted entirely', () => {
    expect(validateAssetMap({}, cwd)).toEqual([])
    expect(validateAssetMap(null, cwd)).toEqual([])
  })

  it('accepts a valid custom dest under the project root', () => {
    makeDir('src/templates/invoices')
    const config: KickConfig = {
      assetMap: {
        invoices: { src: 'src/templates/invoices', dest: 'dist/templates/invoices' },
      },
    }
    expect(validateAssetMap(config, cwd)).toEqual([])
  })
})

describe('validateAssetMap — invalid keys', () => {
  it('warns on an empty namespace key', () => {
    makeDir('src/x')
    const config: KickConfig = {
      assetMap: { '': { src: 'src/x' } },
    }
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/non-empty string/)
  })

  it("warns when a namespace key contains '/'", () => {
    makeDir('src/x')
    const config: KickConfig = {
      assetMap: { 'mails/inner': { src: 'src/x' } },
    }
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/'\//)
  })
})

describe('validateAssetMap — invalid src', () => {
  it('warns when src is missing', () => {
    const config = {
      assetMap: { mails: {} as { src: string } },
    } as unknown as KickConfig
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/missing a non-empty 'src'/)
  })

  it('warns when src is an empty string', () => {
    const config: KickConfig = {
      assetMap: { mails: { src: '' } },
    }
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/non-empty 'src'/)
  })

  it('warns when src directory does not exist', () => {
    const config: KickConfig = {
      assetMap: { mails: { src: 'src/missing-dir' } },
    }
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/does not exist/)
  })
})

describe('validateAssetMap — dest escape protection', () => {
  it('warns when dest resolves outside the project root', () => {
    makeDir('src/x')
    const config: KickConfig = {
      assetMap: { mails: { src: 'src/x', dest: '../escape' } },
    }
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/outside the project root/)
  })

  it('accepts deep nested dest under the project root', () => {
    makeDir('src/x')
    const config: KickConfig = {
      assetMap: { mails: { src: 'src/x', dest: 'dist/deep/nested/dest' } },
    }
    expect(validateAssetMap(config, cwd)).toEqual([])
  })
})

describe('validateAssetMap — multi-entry walk', () => {
  it('reports warnings from every offending entry, not just the first', () => {
    makeDir('src/valid')
    const config: KickConfig = {
      assetMap: {
        valid: { src: 'src/valid' },
        missing: { src: 'src/does-not-exist' },
        empty: { src: '' },
      },
    }
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/missing/)
    expect(warnings[1]).toMatch(/empty/)
  })

  it('does not let one bad entry mask others', () => {
    const config: KickConfig = {
      assetMap: {
        a: { src: '' },
        'b/inner': { src: 'src/x' },
        c: { src: 'src/missing' },
      },
    }
    const warnings = validateAssetMap(config, cwd)
    expect(warnings).toHaveLength(3)
  })
})
