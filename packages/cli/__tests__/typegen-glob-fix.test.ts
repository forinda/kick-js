import { describe, expect, it } from 'vitest'
import {
  globForOrphanFile,
  suggestGlobsForOrphans,
  patchModuleGlobSource,
} from '../src/typegen/glob-fix'
import { fileMatchesAnyGlob, extractGlobPatterns } from '../src/typegen/scanner'

// forinda/kick-js#235 §4 follow-up — turn the orphaned-class DETECTION into a
// FIX: derive the recursive globs that would cover orphans and splice them into
// the module's import.meta.glob() call (`kick typegen --fix`).

describe('globForOrphanFile — derive a recursive glob from a file path', () => {
  it('uses the compound suffix so only sibling kinds match, at any depth', () => {
    expect(globForOrphanFile('src/modules/expenses/controllers/expenses.controller.ts')).toBe(
      './**/*.controller.ts',
    )
    expect(globForOrphanFile('src/modules/x/foo.service.ts')).toBe('./**/*.service.ts')
  })

  it('falls back to the bare extension when there is no compound suffix', () => {
    expect(globForOrphanFile('src/modules/x/handlers/thing.ts')).toBe('./**/*.ts')
  })

  it('normalises Windows separators', () => {
    expect(globForOrphanFile('src\\modules\\x\\controllers\\x.controller.ts')).toBe(
      './**/*.controller.ts',
    )
  })

  it('the derived glob actually matches the orphan (round-trip)', () => {
    // fileMatchesAnyGlob takes a path relative to the module dir.
    const glob = globForOrphanFile('controllers/expenses.controller.ts')
    expect(fileMatchesAnyGlob('./controllers/expenses.controller.ts', [glob])).toBe(true)
    expect(fileMatchesAnyGlob('./controllers/deep/nested/petty-cash.controller.ts', [glob])).toBe(
      true,
    )
  })
})

describe('suggestGlobsForOrphans — distinct, sorted', () => {
  it('collapses many controllers to one recursive pattern', () => {
    const patterns = suggestGlobsForOrphans([
      { relativePath: 'src/modules/expenses/controllers/expenses.controller.ts' },
      { relativePath: 'src/modules/expenses/controllers/expenses-setup.controller.ts' },
      { relativePath: 'src/modules/expenses/controllers/petty-cash.controller.ts' },
    ])
    expect(patterns).toEqual(['./**/*.controller.ts'])
  })

  it('returns one pattern per distinct kind, sorted', () => {
    const patterns = suggestGlobsForOrphans([
      { relativePath: 'a/x.service.ts' },
      { relativePath: 'a/y.controller.ts' },
    ])
    expect(patterns).toEqual(['./**/*.controller.ts', './**/*.service.ts'])
  })
})

describe('patchModuleGlobSource — splice patterns into the call', () => {
  it('inserts into the array form before the closing bracket', () => {
    const source = `import.meta.glob(['./**/*.service.ts', '!./**/*.test.ts'], { eager: true })`
    const out = patchModuleGlobSource(source, ['./**/*.controller.ts'])
    expect(out).not.toBeNull()
    expect(extractGlobPatterns(out!)).toContain('./**/*.controller.ts')
    // Existing patterns survive.
    expect(extractGlobPatterns(out!)).toEqual(
      expect.arrayContaining(['./**/*.service.ts', '!./**/*.test.ts', './**/*.controller.ts']),
    )
  })

  it('is idempotent — already-present patterns add nothing', () => {
    const source = `import.meta.glob(['./**/*.controller.ts'], { eager: true })`
    expect(patchModuleGlobSource(source, ['./**/*.controller.ts'])).toBeNull()
  })

  it("doesn't re-add a pattern that exists only as a negation body", () => {
    const source = `import.meta.glob(['./**/*.service.ts', '!./**/*.test.ts'], { eager: true })`
    // ./**/*.test.ts is present (negated) — adding the positive form is skipped.
    expect(patchModuleGlobSource(source, ['./**/*.test.ts'])).toBeNull()
  })

  it('upgrades the bare-string form into an array', () => {
    const source = `import.meta.glob('./**/*.service.ts', { eager: true })`
    const out = patchModuleGlobSource(source, ['./**/*.controller.ts'])
    expect(out).not.toBeNull()
    expect(out).toContain(`['./**/*.service.ts', './**/*.controller.ts']`)
    expect(extractGlobPatterns(out!)).toEqual(['./**/*.service.ts', './**/*.controller.ts'])
  })

  it('returns null when there is no import.meta.glob call', () => {
    expect(patchModuleGlobSource(`export const x = 1`, ['./**/*.controller.ts'])).toBeNull()
  })

  it('handles a multi-line array with a trailing comma', () => {
    const source = [
      'import.meta.glob(',
      '  [',
      "    './**/*.service.ts',",
      "    '!./**/*.test.ts',",
      '  ],',
      '  { eager: true },',
      ')',
    ].join('\n')
    const out = patchModuleGlobSource(source, ['./**/*.controller.ts'])
    expect(out).not.toBeNull()
    expect(extractGlobPatterns(out!)).toContain('./**/*.controller.ts')
    // Still a single glob call, still valid patterns.
    expect(extractGlobPatterns(out!)).toEqual(
      expect.arrayContaining(['./**/*.service.ts', '!./**/*.test.ts', './**/*.controller.ts']),
    )
  })
})
