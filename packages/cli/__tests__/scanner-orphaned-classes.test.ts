import { describe, expect, it } from 'vitest'
import { extractGlobPatterns, fileMatchesAnyGlob } from '../src/typegen/scanner'

// forinda/kick-js#235 §4 — `import.meta.glob([...])` registration in
// module files silently misses decorator files outside the pattern
// list. The scanner now extracts the patterns and the typegen runner
// warns when a `@Service` / `@Controller` / `@Repository` class file
// lives in the module directory but isn't picked up by any pattern.
// This test locks the underlying matchers.

describe('forinda/kick-js#235 §4 — extractGlobPatterns', () => {
  it('pulls every string literal from import.meta.glob([...]) array form', () => {
    const source = `
      import.meta.glob(
        [
          './**/*.controller.ts',
          './**/*.service.ts',
          './**/*-repository.ts',
          './**/*.use-case.ts',
          '!./**/*.test.ts',
        ],
        { eager: true },
      )
    `
    expect(extractGlobPatterns(source)).toEqual([
      './**/*.controller.ts',
      './**/*.service.ts',
      './**/*-repository.ts',
      './**/*.use-case.ts',
      '!./**/*.test.ts',
    ])
  })

  it('pulls a single-string pattern (no array)', () => {
    const source = `import.meta.glob('./**/*.service.ts', { eager: true })`
    expect(extractGlobPatterns(source)).toEqual(['./**/*.service.ts'])
  })

  it('returns empty when no import.meta.glob call exists', () => {
    expect(extractGlobPatterns(`export class Foo {}`)).toEqual([])
  })
})

describe('forinda/kick-js#235 §4 — fileMatchesAnyGlob', () => {
  const patterns = [
    './**/*.controller.ts',
    './**/*.service.ts',
    './**/*-repository.ts',
    './**/*.use-case.ts',
    '!./**/*.test.ts',
  ]

  it('matches a controller file via the recursive **/* pattern', () => {
    expect(fileMatchesAnyGlob('domain/services/users.controller.ts', patterns)).toBe(true)
  })

  it('matches a service file', () => {
    expect(fileMatchesAnyGlob('application/use-cases/create-user.use-case.ts', patterns)).toBe(true)
  })

  it('matches a repository file via the dash-suffix pattern', () => {
    expect(fileMatchesAnyGlob('infrastructure/users-repository.ts', patterns)).toBe(true)
  })

  it('the issue example — context-decorators/*.ts is NOT matched', () => {
    // The exact case from forinda/kick-js#235 §4: adding a new file
    // type without extending the glob.
    expect(fileMatchesAnyGlob('context-decorators/require-extension.ts', patterns)).toBe(false)
  })

  it('a test file matches a positive pattern but is excluded by the negation', () => {
    expect(fileMatchesAnyGlob('domain/services/users.controller.test.ts', patterns)).toBe(false)
  })

  it('returns false for a totally unrelated file in the module directory', () => {
    expect(fileMatchesAnyGlob('README.md', patterns)).toBe(false)
  })
})
