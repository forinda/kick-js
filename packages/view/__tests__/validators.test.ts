import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { check } from '../src/check/check'
import { createViews } from '../src/index'
import { parse } from '../src/parse/template'
import { BUILTIN_PIPES } from '../src/pipes/builtins'
import { parseValidate } from '../src/validators'

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-validate-'))
  for (const [name, src] of Object.entries(files)) {
    const file = join(root, `${name}.kick`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, src)
  }
  return root
}

const page = (src: string) => createViews({ viewsDir: dir({ page: src }), warn: vi.fn() })

function errors(src: string): string[] {
  const templates = new Map([['page', parse(src, 'page.kick').ast]])
  return check('page', { templates, pipes: new Set(BUILTIN_PIPES), componentsDir: 'components' })
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message)
}

describe('validate', () => {
  it('parses rules', () => {
    expect(parseValidate("required | minLength:3 | pattern:'^[a-z]+$' | in:'a,b'")).toEqual({
      rules: [['required'], ['minLength', 3], ['pattern', '^[a-z]+$'], ['in', 'a,b']],
    })
  })

  it('refuses unknown or malformed rules', () => {
    for (const [src, part] of [
      ['requird', "unknown validator 'requird'"],
      ['minLength', 'minLength takes 1 argument'],
      ['minLength:x', 'minLength takes a number'],
      ["pattern:'['", "pattern '[' isn't a valid regular expression"],
    ] as const) {
      const r = parseValidate(src)
      expect('error' in r && r.error).toContain(part)
    }
  })

  it('renders rule data as an attribute, escaped', async () => {
    const html = await page(`<input name="a" validate="required | pattern:'x&quot;<y'">`).render(
      'page',
    )
    expect(html).toContain('data-kick-validate="[[&quot;required&quot;],[&quot;pattern&quot;,')
    expect(html).not.toContain(' validate=')
    // No raw quote ends the attribute early.
    expect(/data-kick-validate="([^"]*)"/.exec(html)![1]).not.toContain('"')
  })

  it('validate needs a name, and is written, not bound', () => {
    expect(errors('<input validate="required">')).toContain(
      'validate needs a name on the same field',
    )
    expect(errors('<input name="a" [validate]="rules">')).toContain(
      'validate must be written, not bound',
    )
  })

  it('@error renders its spot either way', async () => {
    const v = page('<input name="t">@error(\'t\') {<b>{{ $message }}</b>}')
    expect(await v.render('page', { $errors: { t: 'Too short' } })).toContain(
      '<span data-kick-error="t"><b>Too short</b></span>',
    )
    expect(await v.render('page', { $errors: {} })).toContain(
      '<span data-kick-error="t" hidden></span>',
    )
  })
})

const VTAG = /<script type="module" src="\/_kick\/c\/kick-validate\.[0-9a-f]{8}\.js"><\/script>/g

describe('the validator script', () => {
  const views = (files: Record<string, string>) =>
    createViews({ viewsDir: dir(files), warn: vi.fn() })

  it('no validate, no script', async () => {
    const html = await views({ page: '<input name="t">@error(\'t\') {x}' }).render('page')
    expect(html).not.toContain('<script')
  })

  it('one validator script from pages, layouts and components', async () => {
    const v = views({
      'layouts/main': '<html><body><input name="q" validate="required"><slot /></body></html>',
      'components/text-field': '@input name\n<input [name]="name" validate="required">',
      page: '@layout(\'layouts/main\')\n<input name="a" validate="email"><text-field name="b" />',
    })
    expect((await v.render('page')).match(VTAG)).toHaveLength(1)
    const only = views({
      'components/text-field': '@input name\n<input name="x" validate="required">',
      page: '<text-field name="b" />',
    })
    expect((await only.render('page')).match(VTAG)).toHaveLength(1)
  })

  it('serves the validator runtime, and reserves its name', async () => {
    const v = views({ page: '<input name="a" validate="required">' })
    const file = /kick-validate\.[0-9a-f]{8}\.js/.exec(await v.render('page'))![0]
    expect(await v.clientScript(file)).toContain('data-kick-validate')
    expect(await v.clientScript('kick-validate.00000000.js')).toBeUndefined()
    const templates = new Map([
      [
        'components/kick-validate',
        parse('<div></div><script client>let a = 1</script>', 'x.kick').ast,
      ],
    ])
    expect(
      check('components/kick-validate', {
        templates,
        pipes: new Set(BUILTIN_PIPES),
        componentsDir: 'components',
      }).diagnostics.map((d) => d.message),
    ).toContain('kick-validate is reserved for the validator script')
  })
})
