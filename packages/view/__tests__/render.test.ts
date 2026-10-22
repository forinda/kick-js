import { describe, expect, it, vi } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import type { Project } from '../src/check/project'
import { render, RenderError, type RenderEnv } from '../src/render/render'
import { SafeHtml } from '../src/render/safe'

const PIPES = {
  upper: (v: unknown) => String(v).toUpperCase(),
  raw: (v: unknown) => new SafeHtml(String(v ?? '')),
  json: (v: unknown) => JSON.stringify(v),
}

function setup(files: Record<string, string>, env: Partial<RenderEnv> = {}) {
  const templates = new Map(Object.entries(files).map(([n, s]) => [n, parse(s, `${n}.kick`).ast]))
  const project: Project = {
    templates,
    pipes: new Set(Object.keys(PIPES)),
    componentsDir: 'components',
    defaultLayout: env.defaultLayout,
  }
  const resolve = (name: string) => {
    const r = check(name, project)
    if (!r.template) throw new Error(r.diagnostics.map((d) => d.message).join('\n'))
    return r.template
  }
  const warn = vi.fn()
  const full: RenderEnv = {
    locale: 'en-US',
    timeZone: 'UTC',
    strict: false,
    pipes: PIPES,
    warn,
    resolve,
    ...env,
  }
  return { resolve, env: full, warn }
}

function r(
  files: Record<string, string>,
  data: object = {},
  env: Partial<RenderEnv> = {},
  opts?: { layout?: boolean },
) {
  const s = setup(files, env)
  return { html: render(s.resolve('page'), data, s.env, opts), warn: s.warn }
}
const html = (src: string, data: object = {}, env: Partial<RenderEnv> = {}) =>
  r({ page: src }, data, env).html

describe('render', () => {
  it('prints values per the table', () => {
    expect(
      html('{{ s }}|{{ b }}|{{ t }}|{{ n }}|{{ d }}', {
        s: '<a>&',
        b: 1n,
        t: true,
        n: null,
        d: new Date(0),
      }),
    ).toBe('&lt;a&gt;&amp;|1|true||1970-01-01T00:00:00.000Z')
    expect(html('{{ x }}', { x: 1.5 })).toBe('1.5')
    for (const value of [[1], {}, Promise.resolve()]) {
      const { html: out, warn } = r({ page: '[{{ v }}]' }, { v: value })
      expect(out).toBe('[]')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(() => r({ page: '{{ v }}' }, { v: value }, { strict: true })).toThrow(RenderError)
    }
  })

  it('raw in text', () => {
    expect(html('{{ h | raw }}', { h: '<b>x</b>' })).toBe('<b>x</b>')
  })

  it('attributes', () => {
    expect(html('<a href="{{ u }}">x</a>', { u: 'javascript:x' })).toBe('<a href="#">x</a>')
    expect(html('<a href="{{ a }}{{ b }}">x</a>', { a: 'java', b: 'script:x' })).toBe(
      '<a href="#">x</a>',
    )
    expect(html('<a href="/u/{{ id }}?q={{ q }}">x</a>', { id: 7, q: '"x"' })).toBe(
      '<a href="/u/7?q=&quot;x&quot;">x</a>',
    )
    expect(html('<img srcset="{{ s }}">', { s: 'a.png 1x, javascript:x 2x' })).toBe(
      '<img srcset="a.png 1x, # 2x">',
    )
    expect(html('<button [disabled]="d">x</button>', { d: false })).toBe('<button>x</button>')
    expect(html('<button [disabled]="d">x</button>', { d: true })).toBe(
      '<button disabled>x</button>',
    )
    expect(html('<p [title]="t">x</p>', { t: null })).toBe('<p>x</p>')
    expect(html('<p [title]="t">x</p>', { t: 'a"b' })).toBe('<p title="a&quot;b">x</p>')
    expect(html('<p class="a" [class.on]="x" [class.off]="!x">x</p>', { x: true })).toBe(
      '<p class="a on">x</p>',
    )
    expect(html('<p [style.width.px]="w">x</p>', { w: 10 })).toBe('<p style="width:10px">x</p>')
    const { html: dropped, warn } = r({ page: '<p [style.color]="c">x</p>' }, { c: 'red;x:y' })
    expect(dropped).toBe('<p>x</p>')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('json script', () => {
    const out = html('<script type="application/json">{{ d | json }}</script>', {
      d: { s: '</script>' },
    })
    expect(out.indexOf('</script>')).toBe(out.length - '</script>'.length)
    expect(JSON.parse(out.slice(out.indexOf('>') + 1, -'</script>'.length))).toEqual({
      s: '</script>',
    })
  })

  it('control flow', () => {
    expect(html('@if (a) {A} @else if (b; as v) {B{{ v }}} @else {C}', { a: 0, b: 'x' })).toBe('Bx')
    expect(html('@if (a) {A} @else {C}', { a: '' })).toBe('C')
    expect(
      html(
        '@for (x of xs; let i = $index) {{{ i }}{{ x }}{{ $first }}{{ $last }}{{ $even }}{{ $odd }}{{ $count }},}',
        {
          xs: ['a', 'b'],
        },
      ),
    ).toBe('0atruefalsetruefalse2,1bfalsetruefalsetrue2,')
    expect(html('@for (x of s) {{{ x }}.}', { s: new Set([1, 2]) })).toBe('1.2.')
    expect(html('@for (x of s) {{{ x }}.}', { s: 'ab' })).toBe('a.b.')
    expect(html('@for ([k, v] of m) {{{ k }}={{ v }};}', { m: new Map([['a', 1]]) })).toBe('a=1;')
    expect(html('@for (x of xs) {x} @empty {none}', { xs: null })).toBe('none')
    expect(html('@for (x of xs) {x} @empty {none}', { xs: [] })).toBe('none')
    expect(() => html('@for (x of xs) {x}', { xs: 5 })).toThrow(RenderError)
    expect(html("@switch (s) { @case ('a') {A} @case (1) {one} @default {D} }", { s: '1' })).toBe(
      'D',
    )
    expect(html("@switch (s) { @case ('a') {A} @default {D} }", { s: 'a' })).toBe('A')
    expect(html('@let t = a + b;{{ t }}', { a: 1, b: 2 })).toBe('3')
    expect(html('@if (true) {@let t = 1;{{ t }}}{{ t }}', { t: 'page' })).toBe('1page')
  })

  it('strict equality', () => {
    expect(html("@if (1 == '1') {y} @else {n}")).toBe('n')
    expect(html("@if (a != '1') {y} @else {n}", { a: 1 })).toBe('y')
  })

  it('unresolved names', () => {
    const { warn } = r({ page: '{{ nope }}{{ nope }}{{ also }}' })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(() => r({ page: '{{ nope }}' }, {}, { strict: true })).toThrow(RenderError)
  })

  it('layouts', () => {
    const files = {
      page: "@layout('main')\n@slot('head') {<meta name=x>}\n<h1>{{ t }}</h1>",
      main: '@layout(\'outer\')<head><slot name="head" /></head><main><slot /></main>',
      outer: '<html><slot /></html>',
    }
    expect(r(files, { t: 'Hi' }).html).toBe(
      '<html><head><meta name="x"></head><main>\n<h1>Hi</h1></main></html>',
    )
    expect(r(files, { t: 'Hi' }, {}, { layout: false }).html).toBe('\n<h1>Hi</h1>')
    expect(r({ page: 'p', main: '[<slot />]' }, {}, { defaultLayout: 'main' }).html).toBe('[p]')
    expect(
      r({ page: '@layout(none)p', main: '[<slot />]' }, {}, { defaultLayout: 'main' }).html,
    ).toBe('p')
  })

  it('components', () => {
    const files = {
      page: '<user-card [user]="u" compact class="mb" [class.on]="on">extra {{ note }}</user-card>',
      'components/user-card':
        '@input user\n@input compact = false\n<div class="card">{{ user.name }}@if (!compact) {<i>{{ user.email }}</i>}<slot>none</slot></div>',
    }
    expect(r(files, { u: { name: 'Ada', email: 'a@x' }, note: 'N', on: true }).html).toBe(
      '<div class="card mb on">Adaextra N</div>',
    )
    expect(
      r(
        { page: '<user-card [user]="u" />', 'components/user-card': files['components/user-card'] },
        { u: { name: 'Ada', email: 'a@x' } },
      ).html,
    ).toBe('<div class="card">Ada<i>a@x</i>none</div>')
  })

  it('recursion limit', () => {
    const files = { page: '<x-loop />', 'components/x-loop': '<b><x-loop /></b>' }
    try {
      r(files)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(RenderError)
      const d = (e as RenderError).diagnostic
      expect(d.stack).toHaveLength(65)
      expect(d.stack![0]).toBe('page')
      expect(d.message).toContain('64')
    }
  })

  it('renders deep nesting and long loops', () => {
    const deep = '<div>'.repeat(2000) + '{{ x }}' + '</div>'.repeat(2000)
    expect(html(deep, { x: 'y' })).toContain('y')
    const rows = Array.from({ length: 10_000 }, (_, i) => i)
    expect(html('@for (r of rows) {<li>{{ r }}</li>}', { rows })).toContain('<li>9999</li>')
  })

  it('errors carry the template position', () => {
    try {
      html('<p>\n  {{ x | upper2 }}</p>')
    } catch {
      // unknown pipe is a check error, not a render error
    }
    const boom = {
      boom: () => {
        throw new Error('nope')
      },
    }
    const s = setup({ page: '<p>\n  {{ x | boom }}</p>' }, { pipes: { ...PIPES, ...boom } })
    try {
      // `boom` isn't in the project's pipes, so check it with a project that has it
      render(
        check('page', {
          templates: new Map([['page', parse('<p>\n  {{ x | boom }}</p>', 'page.kick').ast]]),
          pipes: new Set(['boom']),
          componentsDir: 'components',
        }).template!,
        {},
        s.env,
      )
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(RenderError)
      expect((e as RenderError).diagnostic.span.start).toMatchObject({ line: 2, column: 3 })
      expect((e as RenderError).message).toContain('nope')
    }
  })
})
