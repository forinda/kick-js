/** createViews ships the app's validators: the script tag, the served module, checking. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AST_FORMAT_VERSION, createViews, VALIDATORS_REGISTER } from '../src/index'
import { check } from '../src/check/check'
import { parse } from '../src/parse/template'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

function app(files: Record<string, string>): { viewsDir: string; validatorsFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'kick-validators-'))
  for (const [name, src] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), src)
  }
  return { viewsDir: root, validatorsFile: join(root, 'validators.ts') }
}

const PHONE = "export const phone = (v: string): string | undefined => v ? undefined : 'x'\n"
const srcOf = (html: string, tag: string) =>
  new RegExp(`src="(/_kick/c/${tag}\\.[^"]+)"`).exec(html)?.[1]

describe('createViews and validators.ts', () => {
  it('validate page gets the validators script after the built-in one', async () => {
    const v = createViews({
      ...app({ 'page.kick': '<input name="p" validate="phone">', 'validators.ts': PHONE }),
      warn: vi.fn(),
    })
    const html = await v.render('page')
    const builtIn = html.indexOf('kick-validate.')
    const custom = html.indexOf('kick-validators.')
    expect(builtIn).toBeGreaterThan(-1)
    expect(custom).toBeGreaterThan(builtIn)
  })

  it('served validators module is stripped JS ending with VALIDATORS_REGISTER', async () => {
    const v = createViews({
      ...app({ 'page.kick': '<input name="p" validate="phone">', 'validators.ts': PHONE }),
      warn: vi.fn(),
    })
    const file = srcOf(await v.render('page'), 'kick-validators')!
      .split('/')
      .pop()!
    const js = await v.clientScript(file)
    expect(js).toContain('export const phone')
    expect(js).not.toContain(': string')
    expect(js!.endsWith(VALIDATORS_REGISTER)).toBe(true)
    expect(await v.clientScript(file.replace(/\.[^.]+\.js$/, '.AAAAAAAA.js'))).toBeUndefined()
  })

  it('a validators.js is served as written, no stripper needed', async () => {
    const files = app({
      'page.kick': '<input name="p" validate="phone">',
      'validators.js': "export const phone = (v) => (v ? undefined : 'x')\n",
    })
    const v = createViews({
      viewsDir: files.viewsDir,
      validatorsFile: join(files.viewsDir, 'validators.js'),
      stripTypes: () => {
        throw new Error('stripped a .js file')
      },
      warn: vi.fn(),
    })
    const file = srcOf(await v.render('page'), 'kick-validators')!
      .split('/')
      .pop()!
    const js = await v.clientScript(file)
    expect(js).toContain('export const phone = (v) =>')
    expect(js!.endsWith(VALIDATORS_REGISTER)).toBe(true)
  })

  it('an async stripTypes is awaited before the register call is added', async () => {
    const v = createViews({
      ...app({ 'page.kick': '<input name="p" validate="phone">', 'validators.ts': PHONE }),
      stripTypes: async () => "export const phone = (v) => (v ? undefined : 'x')\n",
      warn: vi.fn(),
    })
    const file = srcOf(await v.render('page'), 'kick-validators')!
      .split('/')
      .pop()!
    const js = await v.clientScript(file)
    expect(js!.startsWith('export const phone')).toBe(true)
  })

  it('no validators.ts: no extra tag', async () => {
    const v = createViews({
      ...app({ 'page.kick': '<input name="p" validate="required">' }),
      warn: vi.fn(),
    })
    expect(await v.render('page')).not.toContain('kick-validators.')
  })

  it('page without validate: no tags', async () => {
    const v = createViews({
      ...app({ 'page.kick': '<p>hi</p>', 'validators.ts': PHONE }),
      warn: vi.fn(),
    })
    expect(await v.render('page')).toBe('<p>hi</p>')
  })

  it('from source, an importing validators.ts fails validate pages only', async () => {
    const v = createViews({
      ...app({
        'page.kick': '<input name="p" validate="required">',
        'plain.kick': '<p>hi</p>',
        'validators.ts': "import { x } from './x'\nexport const phone = () => x\n",
      }),
      warn: vi.fn(),
    })
    await expect(v.render('page')).rejects.toThrow(
      'client scripts that import need kick dev or a kick build',
    )
    expect(await v.render('plain')).toBe('<p>hi</p>')
  })

  it("bundle: tag from client.entries['kick-validators']", async () => {
    const page = check('page', {
      templates: new Map([['page', parse('<input name="p" validate="phone">', 'page.kick').ast]]),
      pipes: new Set(BUILTIN_PIPES),
      componentsDir: 'components',
      validators: new Set(['phone']),
    }).template!
    const bundle = (entries: Record<string, string>) =>
      createViews({
        bundle: { v: AST_FORMAT_VERSION, templates: { page }, client: { entries } } as never,
        warn: vi.fn(),
      })
    const html = await bundle({ 'kick-validators': 'kick-validators.AbCd1234.js' }).render('page')
    expect(srcOf(html, 'kick-validators')).toBe('/_kick/c/kick-validators.AbCd1234.js')
    expect(await bundle({}).render('page')).not.toContain('kick-validators.')
  })

  it('bundle: CSS that validators.ts imports is linked on validate pages', async () => {
    const page = check('page', {
      templates: new Map([
        [
          'page',
          parse(
            '<html><head></head><body><input name="p" validate="phone"></body></html>',
            'page.kick',
          ).ast,
        ],
      ]),
      pipes: new Set(BUILTIN_PIPES),
      componentsDir: 'components',
      validators: new Set(['phone']),
    }).template!
    const v = createViews({
      bundle: {
        v: AST_FORMAT_VERSION,
        templates: { page },
        client: {
          entries: { 'kick-validators': 'kick-validators.AbCd1234.js' },
          css: { 'kick-validators': ['kick-validators.Cs5_12-x.css'] },
          files: {},
        },
      } as never,
      warn: vi.fn(),
    })
    expect(await v.render('page')).toContain(
      '<link rel="stylesheet" href="/_kick/c/kick-validators.Cs5_12-x.css"></head>',
    )
  })

  it('custom name in a template checks against validators.ts', async () => {
    const files = { 'page.kick': '<input name="p" validate="phone">' }
    const without = createViews({ ...app(files), warn: vi.fn() })
    await expect(without.render('page')).rejects.toThrow("unknown validator 'phone'")
    const withIt = createViews({ ...app({ ...files, 'validators.ts': PHONE }), warn: vi.fn() })
    await expect(withIt.render('page')).resolves.toContain('data-kick-validate')
  })
})

describe('validators.ts under kick dev (bundle: null)', () => {
  it('never serves validators.ts itself: Vite does, and a miss is a 404, not raw TypeScript', async () => {
    const files = app({ 'page.kick': '<input name="p" validate="phone">', 'validators.ts': PHONE })
    const v = createViews({ ...files, bundle: null, warn: vi.fn() })
    const file = srcOf(await v.render('page'), 'kick-validators')!
      .split('/')
      .pop()!
    expect(await v.clientScript(file)).toBeUndefined()
  })
})

describe('validators.ts beside a moved views folder', () => {
  it('defaults to <viewsDir>/validators.ts', async () => {
    const { viewsDir } = app({
      'page.kick': '<input name="p" validate="phone">',
      'validators.ts': PHONE,
    })
    const v = createViews({ viewsDir, warn: vi.fn() })
    expect(await v.render('page')).toContain('kick-validators.')
  })
})
