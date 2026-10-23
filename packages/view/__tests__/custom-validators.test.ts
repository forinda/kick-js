/** The app's own validators: names read from validators.ts, checked like pipes. */
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check'
import { readPipeExports, readValidatorExports, VALIDATORS_TAG } from '../src/index'
import { parse } from '../src/parse/template'
import { BUILTIN_PIPES } from '../src/pipes/builtins'
import { parseValidate } from '../src/validators'

function errors(src: string, validators?: Set<string>, name = 'page'): string[] {
  const templates = new Map([[name, parse(src, `${name}.kick`).ast]])
  return check(name, {
    templates,
    pipes: new Set(BUILTIN_PIPES),
    componentsDir: 'components',
    validators,
  }).diagnostics.map((d) => d.message)
}

describe('custom validators', () => {
  it('reads the names validators.ts exports', () => {
    const r = readValidatorExports(
      'export const phone = (v: string) => undefined\nexport function sameAs() {}\n',
      'validators.ts',
    )
    expect(r).toEqual({ names: ['phone', 'sameAs'], diagnostics: [] })
  })

  it('refuses a built-in name', () => {
    const r = readValidatorExports('export const email = () => undefined', 'validators.ts')
    expect(r.names).toEqual([])
    expect(r.diagnostics.map((d) => d.message).join()).toContain("'email' is a built-in validator")
  })

  it('pipes read as before', () => {
    const r = readPipeExports('export const uppercase = (s: string) => s', 'pipes.ts')
    expect(r.diagnostics.map((d) => d.message).join()).toContain("'uppercase' is a built-in pipe")
  })

  it('custom names take any numbers or quoted strings', () => {
    const custom = new Set(['phone', 'sameAs'])
    expect(parseValidate("phone | sameAs:'password':3", custom)).toEqual({
      rules: [['phone'], ['sameAs', 'password', 3]],
    })
    expect(parseValidate('phone')).toEqual({ error: "unknown validator 'phone'" })
    expect(parseValidate('sameAs:password', custom)).toEqual({
      error: 'sameAs takes numbers or quoted strings',
    })
  })

  it('a template checks against the app validators', () => {
    const src = '<input name="p" validate="phone">'
    expect(errors(src, new Set(['phone']))).toEqual([])
    expect(errors(src)).toEqual(["unknown validator 'phone'"])
  })

  it('kick-validators is a reserved component', () => {
    expect(
      errors(
        '<p></p>\n<script client>\nconsole.log(1)\n</script>',
        undefined,
        'components/kick-validators',
      ),
    ).toContain("kick-validators is reserved for the app's validators")
    expect(VALIDATORS_TAG).toBe('kick-validators')
  })
})
