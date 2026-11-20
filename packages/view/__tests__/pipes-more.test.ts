/** The overridable built-in pipes: text, lists and formatting. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_PIPES, builtinPipes, pipesFor } from '../src/pipes/env'
import { OVERRIDABLE_PIPES } from '../src/pipes/builtins'
import { readPipeExports } from '../src/pipes/read-exports'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { render } from '../src/render/render'
import { createViews } from '../src/index'

const env = { locale: 'en-US', timeZone: 'UTC' }
const p = builtinPipes(env)

function renderWith(src: string, data: object, pipes = p) {
  const project = {
    templates: new Map([['page', parse(src, 'page.kick').ast]]),
    pipes: new Set(Object.keys(pipes)),
    componentsDir: 'components',
  }
  const t = check('page', project)
  if (!t.template) throw new Error(t.diagnostics.map((d) => d.message).join())
  return render(t.template, data, {
    ...env,
    strict: false,
    pipes,
    warn: vi.fn(),
    resolve: () => t.template!,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('text pipes', () => {
  it('truncate', () => {
    expect(p.truncate!('abcdef', 3)).toBe('abc…')
    expect(p.truncate!('abc', 3)).toBe('abc')
    expect(p.truncate!('👍👍👍', 2, '...')).toBe('👍👍...')
    expect(p.truncate!(null, 3)).toBe('')
  })

  it('default', () => {
    for (const v of [null, undefined, '']) expect(p.default!(v, '—')).toBe('—')
    expect(p.default!(0, '—')).toBe(0)
    expect(p.default!(false, '—')).toBe(false)
  })

  it('nl2br escapes, then breaks lines', () => {
    expect(renderWith('{{ s | nl2br }}', { s: 'a<b>\nc\r\nd' })).toBe('a&lt;b&gt;<br>c<br>d')
    expect(renderWith('{{ s | nl2br }}', { s: null })).toBe('')
  })

  it('striptags', () => {
    expect(p.striptags!('<p>a <b>b</b></p>')).toBe('a b')
    expect(renderWith('{{ s | striptags }}', { s: '<i>x</i> & y' })).toBe('x &amp; y')
  })
})

describe('list pipes', () => {
  it('first and last', () => {
    expect(p.first!([1, 2, 3])).toBe(1)
    expect(p.last!([1, 2, 3])).toBe(3)
    expect(p.first!('abc')).toBe('a')
    expect(p.last!('abc')).toBe('c')
    expect(p.first!(null)).toBeUndefined()
    expect(p.last!(new Set([1, 2]))).toBe(2)
  })

  it('length', () => {
    expect(p.length!([1, 2, 3])).toBe(3)
    expect(p.length!('abc')).toBe(3)
    expect(p.length!(new Set([1, 2]))).toBe(2)
    expect(p.length!(new Map([[1, 2]]))).toBe(1)
    expect(p.length!({ a: 1 })).toBe(1)
    expect(p.length!(null)).toBe(0)
  })

  it('sort copies, by value or key', () => {
    const sort = p.sort!
    const xs = [3, 1, 2]
    expect(sort(xs)).toEqual([1, 2, 3])
    expect(xs).toEqual([3, 1, 2])
    expect(sort([10, 9, 100])).toEqual([9, 10, 100])
    expect(sort([{ n: 'b' }, { n: 'a' }], 'n')).toEqual([{ n: 'a' }, { n: 'b' }])
    expect(sort(null)).toEqual([])
  })

  it('groupBy keeps first-seen order', () => {
    const a = { s: 'x', i: 1 }
    const b = { s: 'y', i: 2 }
    const c = { s: 'x', i: 3 }
    expect(p.groupBy!([a, b, c], 's')).toEqual([
      ['x', [a, c]],
      ['y', [b]],
    ])
    expect(
      renderWith("@for ([g, xs] of list | groupBy:'s') {{{ g }}{{ xs | length }} }", {
        list: [a, b, c],
      }),
    ).toBe('x2 y1 ')
  })

  it('sum', () => {
    expect(p.sum!([1, 2])).toBe(3)
    expect(p.sum!([{ p: 2 }, { p: 3 }], 'p')).toBe(5)
    expect(p.sum!(null)).toBe(0)
  })
})

describe('formatting pipes', () => {
  it('plural', () => {
    expect(p.plural!(1, 'item', 'items')).toBe('1 item')
    expect(p.plural!(1024, 'item', 'items')).toBe('1,024 items')
    expect(p.plural!(0, 'item', 'items')).toBe('0 items')
  })

  it('ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    expect(p.ago!(new Date('2025-12-31T23:59:30Z'))).toBe('30 seconds ago')
    expect(p.ago!(new Date('2026-01-03T00:00:00Z'))).toBe('in 2 days')
    expect(p.ago!('2025-12-31T21:00:00Z')).toBe('3 hours ago')
    expect(p.ago!(null)).toBe('')
  })

  it('filesize', () => {
    expect(p.filesize!(999)).toMatch(/^999\s?byte/)
    expect(p.filesize!(1500)).toMatch(/^1\.5\s?kB/)
    expect(p.filesize!(2_000_000)).toMatch(/^2\s?MB/)
  })
})

describe('overriding', () => {
  it('lists the new pipes apart from the reserved ones', () => {
    for (const n of OVERRIDABLE_PIPES) expect(BUILTIN_PIPES).not.toContain(n)
    for (const n of OVERRIDABLE_PIPES.filter((n) => n !== 't')) expect(p[n]).toBeTypeOf('function')
  })

  it("lets an app pipe take a new built-in's name, but not a reserved one", () => {
    expect(readPipeExports('export const ago = (d: Date) => ""', 'pipes.ts').names).toEqual(['ago'])
    expect(
      readPipeExports('export const uppercase = (s: string) => s', 'pipes.ts').diagnostics.length,
    ).toBeGreaterThan(0)
    expect(pipesFor({ ago: () => 'mine' }, env).ago!(new Date())).toBe('mine')
  })

  it('renders the app pipe through createViews', async () => {
    const views = createViews({
      loader: { list: async () => ['page'], read: async () => '{{ d | ago }}' },
      pipes: { ago: () => 'mine' },
    })
    expect(await views.render('page', { d: new Date() })).toBe('mine')
  })

  it('checks and renders a new built-in through createViews', async () => {
    const views = createViews({
      loader: { list: async () => ['page'], read: async () => '{{ s | truncate:2 }}' },
    })
    expect(await views.render('page', { s: 'abc' })).toBe('ab…')
  })
})
