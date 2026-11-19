import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createViews, bundleLoader, type ViewsBundle } from '../src/index'
import { fileLoader } from '../src/loaders/file'
import { RenderError } from '../src/render/render'
import { AST_FORMAT_VERSION } from '../src/ast'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-views-'))
  for (const [name, src] of Object.entries(files)) {
    const file = join(root, `${name}.kick`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, src)
  }
  return root
}

describe('createViews', () => {
  it('renders outside a request', async () => {
    const views = createViews({
      viewsDir: dir({ 'emails/welcome': '<p>Hi {{ name }}</p>' }),
      warn: vi.fn(),
    })
    expect(await views.render('emails/welcome', { name: 'Ada' })).toBe('<p>Hi Ada</p>')
  })

  it('rejects bad names', async () => {
    const views = createViews({ viewsDir: dir({ a: 'a' }) })
    await expect(views.render('../secret')).rejects.toThrow('invalid template name')
    await expect(views.render('nope')).rejects.toThrow("template 'nope' not found")
  })

  it('file loader compiles once and dedupes', async () => {
    const loader = fileLoader(dir({ a: '{{ x }}', b: 'b' }))
    const read = vi.spyOn(loader, 'read')
    const views = createViews({ loader })
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => views.render('a', { x: i })))
    expect(out).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(read).toHaveBeenCalledTimes(2) // each file once
  })

  it('dev re-checks mtime', async () => {
    const root = dir({ a: 'one' })
    const dev = createViews({ viewsDir: root, dev: true })
    const prod = createViews({ viewsDir: root })
    expect(await dev.render('a')).toBe('one')
    expect(await prod.render('a')).toBe('one')
    writeFileSync(join(root, 'a.kick'), 'two')
    const later = new Date(Date.now() + 5000)
    utimesSync(join(root, 'a.kick'), later, later)
    expect(await dev.render('a')).toBe('two')
    expect(await prod.render('a')).toBe('one')
  })

  it('re-checks under kick dev (bundle: null) without dev set', async () => {
    const root = dir({ a: 'one' })
    const views = createViews({ viewsDir: root, bundle: null })
    expect(await views.render('a')).toBe('one')
    writeFileSync(join(root, 'a.kick'), 'two')
    const later = new Date(Date.now() + 5000)
    utimesSync(join(root, 'a.kick'), later, later)
    expect(await views.render('a')).toBe('two')
  })

  it('bundle loader', async () => {
    const project = {
      templates: new Map([['home', parse('<h1>{{ t | uppercase }}</h1>', 'home.kick').ast]]),
      pipes: new Set(BUILTIN_PIPES),
      componentsDir: 'components',
    }
    const bundle: ViewsBundle = {
      v: AST_FORMAT_VERSION,
      templates: { home: check('home', project).template! },
    }
    const views = createViews({ bundle })
    expect(await views.render('home', { t: 'x' })).toBe('<h1>X</h1>')
    expect(() => bundleLoader({ v: 999, templates: {} })).toThrow(
      `views bundle format v999, this runtime reads v${AST_FORMAT_VERSION}`,
    )
  })

  it('bundle lookups ignore Object.prototype names', async () => {
    const views = createViews({ bundle: { v: AST_FORMAT_VERSION, templates: {} } })
    for (const name of ['toString', 'valueOf', 'hasOwnProperty', 'constructor']) {
      expect(await views.has(name), name).toBe(false)
      await expect(views.render(name)).rejects.toThrow(`template '${name}' not found`)
    }
  })

  it('share merges under page data', async () => {
    const views = createViews({
      viewsDir: dir({ p: '{{ a }}{{ b }}' }),
      share: (ctx) => ({ a: 1, b: 1, ...(ctx as object) }),
    })
    expect(await views.render('p', { b: 2 })).toBe('12')
    expect(await views.render('p', {}, { ctx: { a: 9 } })).toBe('91')
  })

  it('applies the default layout and the app pipes', async () => {
    const views = createViews({
      viewsDir: dir({ p: '{{ n | twice }}', 'layouts/main': '[<slot />]' }),
      layout: 'layouts/main',
      pipes: { twice: (v: unknown) => `${v}${v}` },
    })
    expect(await views.render('p', { n: 'a' })).toBe('[aa]')
    expect(await views.render('p', { n: 'a' }, { layout: false })).toBe('aa')
  })

  it('maps dashboard layouts by folder inside a base layout', async () => {
    const views = createViews({
      viewsDir: dir({
        'admin/users': "@slot('head') {<title>Users</title>}U",
        'seller/home': 'S',
        about: 'A',
        'layouts/admin': 'admin[<slot />]',
        'layouts/seller': 'seller[<slot />]',
        'layouts/page': 'page[<slot />]',
        'layouts/base':
          '<head><slot name="head"><title>App</title></slot></head><body><slot /></body>',
      }),
      layout: { admin: 'layouts/admin', seller: 'layouts/seller', '': 'layouts/page' },
      baseLayout: 'layouts/base',
      warn: vi.fn(),
    })
    expect(await views.render('admin/users')).toBe(
      '<head><title>Users</title></head><body>admin[U]</body>',
    )
    expect(await views.render('seller/home')).toBe(
      '<head><title>App</title></head><body>seller[S]</body>',
    )
    expect(await views.render('about')).toBe('<head><title>App</title></head><body>page[A]</body>')
    expect(await views.render('about', {}, { layout: false })).toBe('A')
  })

  it('recovers after a failed load', async () => {
    const loader = fileLoader(dir({ a: 'ok' }))
    const read = loader.read
    let fail = true
    loader.read = async (name) => {
      if (fail) {
        fail = false
        throw new Error('EMFILE: too many open files')
      }
      return read(name)
    }
    const views = createViews({ loader })
    await expect(views.render('a')).rejects.toThrow('EMFILE')
    expect(await views.render('a')).toBe('ok')
  })

  it('concurrent renders keep their own env', async () => {
    const views = createViews({ viewsDir: dir({ n: "{{ x | number:'1.2-2' }}" }) })
    const [en, de] = await Promise.all([
      views.render('n', { x: 1234.5 }, { locale: 'en-US' }),
      views.render('n', { x: 1234.5 }, { locale: 'de-DE' }),
    ])
    expect([en, de]).toEqual(['1,234.50', '1.234,50'])
  })

  it('reports template errors as RenderError', async () => {
    const views = createViews({ viewsDir: dir({ bad: '<p>{{ a() }}</p>' }) })
    await expect(views.render('bad')).rejects.toBeInstanceOf(RenderError)
    await expect(views.render('bad')).rejects.toThrow('bad.kick:1:')
  })
})

describe('fragments through views.render', () => {
  const page = "@for (user of users; track user.name) {@fragment('row') {<tr>{{ user.name }}</tr>}}"

  it('renders a fragment from the data passed', async () => {
    const views = createViews({ viewsDir: dir({ p: page }) })
    expect(await views.render('p', { user: { name: 'A' } }, { fragment: 'row' })).toBe('<tr>A</tr>')
  })

  it("doesn't let share() data fill a fragment's needs", async () => {
    const views = createViews({
      viewsDir: dir({ p: page }),
      share: () => ({ user: { name: 'me' } }),
    })
    await expect(views.render('p', {}, { fragment: 'row' })).rejects.toThrow(/needs 'user'/)
  })

  it("doesn't remember a fragment as the page to go back to", async () => {
    const views = createViews({ viewsDir: dir({ p: page }) })
    const ctx = {
      req: { method: 'GET', url: '/rows' },
      session: { data: {} as Record<string, unknown> },
    }
    await views.render('p', { user: { name: 'A' } }, { fragment: 'row', ctx })
    expect(Object.values(ctx.session.data)).not.toContain('/rows')
  })
})

describe('fragments in a bundle', () => {
  it('render after a JSON round-trip, and a v1 bundle is refused', async () => {
    const src = "@for (u of us; track u) {@fragment('row') {<tr>{{ u }}</tr>}}"
    const project = {
      templates: new Map([['p', parse(src, 'p.kick').ast]]),
      pipes: new Set(BUILTIN_PIPES),
      componentsDir: 'components',
    }
    const bundle = JSON.parse(
      JSON.stringify({ v: AST_FORMAT_VERSION, templates: { p: check('p', project).template! } }),
    ) as ViewsBundle
    const views = createViews({ bundle })
    expect(await views.render('p', { u: 'A' }, { fragment: 'row' })).toBe('<tr>A</tr>')
    const old = AST_FORMAT_VERSION - 1
    expect(() => bundleLoader({ v: old, templates: {} })).toThrow(
      `views bundle format v${old}, this runtime reads v${AST_FORMAT_VERSION}`,
    )
  })
})

describe('component features in a bundle', () => {
  it('render after a JSON round-trip: snippets, <component>, slots with values', async () => {
    const files: Record<string, string> = {
      'components/x-a': '<div><slot name="h" [x]="7" /></div>',
      'components/x-b': '<p>b</p>',
      p: '@snippet s(v) {[{{ v }}]}\n@render s(1)<component [is]="k" of="x-a x-b">@slot(\'h\'; let x) {{{ x }}}</component>',
    }
    const project = {
      templates: new Map(Object.entries(files).map(([n, src]) => [n, parse(src, `${n}.kick`).ast])),
      pipes: new Set(BUILTIN_PIPES),
      componentsDir: 'components',
    }
    const templates = Object.fromEntries(
      Object.keys(files).map((n) => [n, check(n, project).template!]),
    )
    const bundle = JSON.parse(JSON.stringify({ v: AST_FORMAT_VERSION, templates })) as ViewsBundle
    const views = createViews({ bundle })
    expect(await views.render('p', { k: 'x-a' })).toBe('[1]<div>7</div>')
    expect(AST_FORMAT_VERSION).toBe(3)
  })
})

describe('page @input defaults', () => {
  const files = {
    'layouts/main': '<title>{{ title }}</title><slot />',
    page: "@layout('layouts/main')\n@input title = 'Home'\n<p>x</p>",
  }

  it('reach the layout', async () => {
    const views = createViews({ viewsDir: dir(files), warn: () => {} })
    expect(await views.render('page')).toBe('<title>Home</title><p>x</p>')
  })

  it('give way to share() and to the controller', async () => {
    const shared = createViews({
      viewsDir: dir(files),
      warn: () => {},
      share: () => ({ title: 'S' }),
    })
    expect(await shared.render('page')).toBe('<title>S</title><p>x</p>')
    expect(await shared.render('page', { title: 'C' })).toBe('<title>C</title><p>x</p>')
  })
})

describe("a layout's @input defaults", () => {
  it('apply under the page, which overrides them', async () => {
    const files = {
      'layouts/main': "@input title = 'Site'\n<title>{{ title }}</title><slot />",
      plain: "@layout('layouts/main')\n<p>x</p>",
      own: "@layout('layouts/main')\n@input title = 'Own'\n<p>x</p>",
    }
    const views = createViews({ viewsDir: dir(files), warn: () => {} })
    expect(await views.render('plain')).toBe('<title>Site</title><p>x</p>')
    expect(await views.render('own')).toBe('<title>Own</title><p>x</p>')
  })
})
