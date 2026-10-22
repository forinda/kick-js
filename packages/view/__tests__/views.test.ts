import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createViews, bundleLoader, type ViewsBundle } from '../src/views'
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
