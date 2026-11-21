/** Rendering templates from named view roots: `createViews({ roots })`. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createViews } from '../src/index'

function dir(files: Record<string, string>, root = mkdtempSync(join(tmpdir(), 'kick-roots-'))) {
  for (const [name, src] of Object.entries(files)) {
    const file = join(root, `${name}.kick`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, src)
  }
  return root
}

const views = (
  app: Record<string, string>,
  roots: Record<string, Record<string, string>>,
  more = {},
) =>
  createViews({
    viewsDir: dir(app),
    roots: Object.fromEntries(Object.entries(roots).map(([n, files]) => [n, dir(files)])),
    warn: () => {},
    ...more,
  })

describe('view roots at render', () => {
  it('renders a root page by its full name', async () => {
    const v = views({}, { billing: { 'invoices/show': '<p>invoice {{ n }}</p>' } })
    expect(await v.render('billing::invoices/show', { n: 7 })).toBe('<p>invoice 7</p>')
  })

  it('keeps same-named pages in two roots apart', async () => {
    const v = views({}, { a: { index: '<p>a</p>' }, b: { index: '<p>b</p>' } })
    expect(await v.render('a::index')).toBe('<p>a</p>')
    expect(await v.render('b::index')).toBe('<p>b</p>')
  })

  it("gives a root page without @layout the app's layout", async () => {
    const v = views(
      { 'layouts/main': '<main><slot /></main>' },
      { billing: { index: '<p>x</p>' } },
      { layout: 'layouts/main' },
    )
    expect(await v.render('billing::index')).toBe('<main><p>x</p></main>')
  })

  it("uses the root's own layout first", async () => {
    const v = views(
      { 'layouts/main': '<main><slot /></main>' },
      {
        ui: {
          'layouts/main': '<div class="ui"><slot /></div>',
          page: "@layout('layouts/main')\n<p>x</p>",
        },
      },
    )
    expect(await v.render('ui::page')).toBe('<div class="ui"><p>x</p></div>')
  })

  it("renders a root's component in an app page", async () => {
    const v = views(
      { page: '<ui-button>Go</ui-button>' },
      { ui: { 'components/button': '<button><slot /></button>' } },
    )
    expect(await v.render('page')).toBe('<button>Go</button>')
  })

  it("renders a root page's fragment with its own layout's defaults", async () => {
    const v = views(
      {},
      {
        ui: {
          'layouts/main': "@input title = 'UI'\n<title>{{ title }}</title><slot />",
          page: "@layout('layouts/main')\n@fragment('f') {<b>{{ title }}</b>}",
        },
      },
      { strict: true },
    )
    expect(await v.render('ui::page', {}, { fragment: 'f' })).toBe('<b>UI</b>')
  })

  it("names the root's file in a render error", async () => {
    const v = views({}, { billing: { 'invoices/show': '<p>{{ a.b }}</p>' } }, { strict: true })
    await expect(v.render('billing::invoices/show')).rejects.toThrow(/invoices\/show\.kick/)
    // The file on disk, not the template's name.
    await expect(v.render('billing::invoices/show')).rejects.not.toThrow(/::invoices\/show\.kick/)
  })

  it('names an unknown root', async () => {
    const v = views({}, {})
    await expect(v.render('nope::x')).rejects.toThrow(/nope::x/)
  })
})

describe('view roots — client scripts', () => {
  it("serves a root component's script by its prefixed tag", async () => {
    const { check } = await import('../src/check/check')
    const { parse } = await import('../src/parse/template')
    const { BUILTIN_PIPES } = await import('../src/pipes/builtins')
    const { AST_FORMAT_VERSION } = await import('../src/ast')
    const files = {
      'ui::components/button': '<button></button>\n<script client>\nconsole.log(1)\n</script>',
      page: '<ui-button></ui-button>',
    }
    const project = {
      templates: new Map(Object.entries(files).map(([n, s]) => [n, parse(s, `${n}.kick`).ast])),
      pipes: new Set(BUILTIN_PIPES),
      componentsDir: 'components',
    }
    const button = check('ui::components/button', project).template!
    button.client = { code: 'console.log(1)', js: true }
    const v = createViews({
      bundle: {
        v: AST_FORMAT_VERSION,
        templates: { 'ui::components/button': button, page: check('page', project).template! },
      },
      warn: () => {},
    })
    const src = /src="\/_kick\/c\/([^"]+)"/.exec(await v.render('page'))![1]!
    expect(src).toMatch(/^ui-button\./)
    expect(await v.clientScript(src)).toContain('console.log(1)')
  })
})

describe('view roots — PR review', () => {
  it("lists without an app views folder, but fails on a root that can't be read", async () => {
    const { multiRootLoader } = await import('../src/loaders/file')
    const ui = dir({ x: '<p></p>' })
    const missing = join(tmpdir(), 'kick-roots-absent-app')
    expect(await multiRootLoader(missing, { ui }).list()).toEqual(['ui::x'])
    await expect(
      multiRootLoader(missing, { ui, gone: join(tmpdir(), 'kick-roots-absent-root') }).list(),
    ).rejects.toThrow()
  })
})

describe('view roots — edges', () => {
  it('refuses a bad root name when the views are made, not at first render', () => {
    expect(() => createViews({ roots: { Billing: tmpdir() }, warn: () => {} })).toThrow(
      /'Billing' isn't a valid root name/,
    )
  })

  it("gives an app page the app's layout, not a root's of the same name", async () => {
    const v = views(
      { 'layouts/main': '<main><slot /></main>', page: "@layout('layouts/main')\n<p>x</p>" },
      { ui: { 'layouts/main': '<div class="ui"><slot /></div>' } },
    )
    expect(await v.render('page')).toBe('<main><p>x</p></main>')
  })

  it('refuses a name with two roots', async () => {
    const v = views({}, { a: { 'b/c': '<p>x</p>' } })
    await expect(v.render('a::b::c')).rejects.toThrow(/a::b::c/)
  })
})

describe('layout map and roots', () => {
  it("maps a whole root with 'name::'", async () => {
    const v = views(
      { 'layouts/main': '<main><slot /></main>', 'layouts/bill': '<b><slot /></b>' },
      { billing: { index: '<p>x</p>', 'invoices/show': '<p>y</p>' } },
      { layout: { '': 'layouts/main', 'billing::': 'layouts/bill' } },
    )
    expect(await v.render('billing::index')).toBe('<b><p>x</p></b>')
    expect(await v.render('billing::invoices/show')).toBe('<b><p>y</p></b>')
  })
})
