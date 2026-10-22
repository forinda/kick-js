import { describe, expect, it, vi } from 'vitest'
import { format } from '../src/format'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { render } from '../src/render/render'
import { builtinPipes } from '../src/pipes/builtins'

const fmt = (src: string) => {
  const r = format(src, 't.kick')
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return r.output!
}

const CORPUS = [
  '<ul>\n@for(x of xs){\n<li>{{x}}</li>\n}\n</ul>\n',
  '@if(a){\n<p>{{ a|uppercase }}</p>\n}@else if(b){\n<p>b</p>\n}@else{\n<p>c</p>\n}\n',
  '<div class="card">\n<h1 [title]="t">{{t}}</h1>\n@switch(s){\n@case(\'a\'){\nA\n}\n@default{\nD\n}\n}\n</div>\n',
  '<pre>\n  keep   this\n    as is {{x}}\n</pre>\n<script type="application/json">{{d|json}}</script>\n',
  '@verbatim {\n   {{ vue }}  @click\n}\n<!--   keep   -->\n{{--  template  comment  --}}\n<p>x</p>\n',
  "@layout('layouts/main')\n@slot('head'){\n<title>{{ t }}</title>\n}\n<main>\n<section>\n<p>{{ body }}</p>\n</section>\n</main>\n",
]

describe('format', () => {
  it('re-indents blocks and elements and normalises spacing', () => {
    expect(fmt('<ul>\n@for(x of xs){\n<li>{{x}}</li>\n}\n</ul>\n')).toBe(
      '<ul>\n  @for (x of xs) {\n    <li>{{ x }}</li>\n  }\n</ul>\n',
    )
    expect(fmt('@if(a){\n<p>{{ a|uppercase }}</p>\n}@else{\n<p>c</p>\n}\n')).toBe(
      '@if (a) {\n  <p>{{ a|uppercase }}</p>\n} @else {\n  <p>c</p>\n}\n',
    )
  })

  it('spaces control flow, not directives', () => {
    expect(fmt('@if(a){\nA\n}@else if(b){\nB\n}\n')).toBe(
      '@if (a) {\n  A\n} @else if (b) {\n  B\n}\n',
    )
    expect(
      fmt(
        "@layout ('layouts/main')\n@slot ( 'head' ){\n<title>t</title>\n}\n@assets ('src/main.ts')\n",
      ),
    ).toBe(
      "@layout('layouts/main')\n@slot('head') {\n  <title>t</title>\n}\n@assets('src/main.ts')\n",
    )
  })

  it('leaves raw regions byte-exact', () => {
    const src = CORPUS[3]!
    const out = fmt(src)
    expect(out).toContain('<pre>\n  keep   this\n    as is {{x}}\n</pre>')
    expect(out).toContain('<script type="application/json">{{d|json}}</script>')
    const out2 = fmt(CORPUS[4]!)
    expect(out2).toContain('@verbatim {\n   {{ vue }}  @click\n}')
    expect(out2).toContain('<!--   keep   -->')
    expect(out2).toContain('{{--  template  comment  --}}')
  })

  it('is idempotent', () => {
    for (const src of CORPUS) {
      const once = fmt(src)
      expect(fmt(once), src).toBe(once)
    }
  })

  it('does not change what renders, apart from whitespace', () => {
    const pipes = builtinPipes({ locale: 'en-US', timeZone: 'UTC' })
    const data = { xs: [1, 2], a: 'x', b: 1, t: 'T', s: 'a', d: { k: 1 }, x: '<y>', body: 'B' }
    const html = (src: string) => {
      const files = { page: src, 'layouts/main': '<slot name="head" /><slot />' }
      const project = {
        templates: new Map(Object.entries(files).map(([n, s]) => [n, parse(s, `${n}.kick`).ast])),
        pipes: new Set(Object.keys(pipes)),
        componentsDir: 'components',
      }
      const t = check('page', project).template!
      return render(t, data, {
        locale: 'en-US',
        timeZone: 'UTC',
        strict: false,
        pipes,
        warn: vi.fn(),
        resolve: (n) => check(n, project).template!,
      })
    }
    const squash = (s: string) => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim()
    for (const src of CORPUS) {
      if (src.includes('vue')) continue
      expect(squash(html(fmt(src))), src).toBe(squash(html(src)))
    }
  })

  it('formats deeply nested markup without overflowing', () => {
    const deep = '<div>\n'.repeat(3000) + '{{x}}\n' + '</div>\n'.repeat(3000)
    const r = format(deep, 't.kick')
    expect(r.output).toBeDefined()
    expect(r.output!).toContain('{{ x }}')
  })

  it('returns a file with parse errors unchanged', () => {
    const r = format('<p>{{ a() }}</p>', 't.kick')
    expect(r.output).toBeUndefined()
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
})
