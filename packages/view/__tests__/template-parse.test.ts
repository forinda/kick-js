import { describe, expect, it } from 'vitest'
import { parse, type Node, type Element } from '../src/parse/template'

/** A compact form of a node list: markup as written, blocks as `@kind[...]`. */
function flat(nodes: Node[]): string {
  return nodes
    .map((n): string => {
      switch (n.k) {
        case 'text':
          return n.value
        case 'interp':
          return `{${n.ctx}:${n.expr.kind === 'path' ? n.expr.root : n.expr.kind}}`
        case 'element':
          return n.void || n.selfClosing ? `<${n.tag}>` : `<${n.tag}>${flat(n.children)}</${n.tag}>`
        case 'comment':
          return `<!--${flat(n.children)}-->`
        case 'if':
          return `@if[${n.branches.map((b) => flat(b.body)).join('|')}]`
        case 'for':
          return `@for[${flat(n.body)}]` + (n.empty ? `@empty[${flat(n.empty)}]` : '')
        case 'switch':
          return `@switch[${n.cases.map((c) => flat(c.body)).join('|')}${n.default ? `|default:${flat(n.default)}` : ''}]`
        case 'let':
          return `@let:${n.name}`
        case 'verbatim':
          return `@verbatim[${n.text}]`
        case 'slot-outlet':
          return `<slot:${n.name ?? ''}>[${flat(n.fallback)}]`
        case 'slot-fill':
          return `@slot:${n.name}[${flat(n.body)}]`
        case 'assets':
          return `@assets:${n.entry}`
        case 'fragment':
          return `@fragment:${n.name}[${flat(n.body)}]`
        case 'push':
          return `@push:${n.name}[${flat(n.body)}]`
        case 'stack':
          return `<stack:${n.name}>`
        case 'snippet':
          return `@snippet:${n.name}(${n.params.map((p) => p.name).join(',')})[${flat(n.body)}]`
        case 'render':
          return `@render:${n.name}(${n.args.length})`
      }
    })
    .join('')
}

const ok = (src: string) => {
  const r = parse(src, 't.kick')
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return r
}
const errors = (src: string) =>
  parse(src, 't.kick').diagnostics.filter((d) => d.severity === 'error')

describe('parse', () => {
  it('tracks contexts', () => {
    expect(flat(ok('<title>{{ a }}</title><p>{{ b }}</p>').ast.body)).toBe(
      '<title>{rcdata:a}</title><p>{text:b}</p>',
    )
    const a = ok('<a href="/u/{{ id }}">x</a>').ast.body[0] as Element
    expect(a.attrs[0]).toMatchObject({ name: 'href', kind: 'interp', quoted: true })
    expect(a.attrs[0]!.parts![0]).toBe('/u/')
    expect((a.attrs[0]!.parts![1] as { kind: string }).kind).toBe('path')
    expect(flat(ok('<script>let a = {{ x }}; if (a) { b() }</script>').ast.body)).toBe(
      '<script>let a = {raw-text:x}; if (a) { b() }</script>',
    )
    expect(flat(ok('<style>a { color: red }</style>').ast.body)).toBe(
      '<style>a { color: red }</style>',
    )
  })

  it('@ starts a block only before a keyword in text', () => {
    expect(flat(ok('mail hi@example.com @foo').ast.body)).toBe('mail hi@example.com @foo')
    const b = ok('<button @click="go()" :class="{ on: x }">x</button>').ast.body[0] as Element
    expect(b.attrs.map((a) => a.name)).toEqual(['@click', ':class'])
    expect(flat(ok('@if (a) { x }').ast.body)).toBe('@if[ x ]')
  })

  it('braces', () => {
    expect(flat(ok('@if (a) { x } y }').ast.body)).toBe('@if[ x ] y }')
    expect(flat(ok('@if (a) { &#125; }').ast.body)).toBe('@if[ &#125; ]')
    expect(flat(ok('a { b').ast.body)).toBe('a { b')
  })

  it('verbatim', () => {
    expect(flat(ok('@verbatim { {{ vue }} @click {a:{b}} }').ast.body)).toBe(
      '@verbatim[ {{ vue }} @click {a:{b}} ]',
    )
    expect(flat(ok("@verbatim { x = '}' }").ast.body)).toBe("@verbatim[ x = '}' ]")
  })

  it('whitespace', () => {
    expect(flat(ok('<ul>\n  @for (x of xs) {\n  <li>{{ x }}</li>\n  }\n</ul>').ast.body)).toBe(
      '<ul>\n@for[  <li>{text:x}</li>\n]</ul>',
    )
    expect(flat(ok('@if (a) {\n  x\n} @else {\n  y\n}\n').ast.body)).toBe('@if[  x\n|  y\n]')
    expect(flat(ok('<pre>\n  @if (a) {\n  x\n  }\n</pre>').ast.body)).toBe(
      '<pre>\n  @if[\n  x\n  ]\n</pre>',
    )
  })

  it('comments', () => {
    expect(flat(ok('a{{-- hidden {{ x }} --}}b').ast.body)).toBe('ab')
    expect(flat(ok('<!-- kept {{ x }} -->').ast.body)).toBe('<!-- kept {comment:x} -->')
  })

  it('layout placement', () => {
    expect(ok("{{-- c --}}\n@layout('layouts/main')\n<p></p>").ast.layout).toBe('layouts/main')
    expect(ok('@layout(none)').ast.layout).toBe(null)
    expect(ok('<p></p>').ast.layout).toBeUndefined()
    expect(errors("<p></p>@layout('x')")[0]!.message).toContain('before any output')
  })

  it('inputs', () => {
    const { ast } = ok('@input user\n@input compact = false\n@input size = -1\n<p></p>')
    expect(ast.inputs.map((i) => [i.name, i.default?.value])).toEqual([
      ['user', undefined],
      ['compact', false],
      ['size', -1],
    ])
    expect(errors('@input a = b.c')[0]!.message).toContain('literal')
  })

  it('case', () => {
    const svg = ok('<svg><linearGradient viewBox="0 0 1 1"></linearGradient></svg>').ast
      .body[0] as Element
    const grad = svg.children[0] as Element
    expect([grad.tag, grad.foreign, grad.attrs[0]!.name]).toEqual([
      'linearGradient',
      true,
      'viewBox',
    ])
    expect(flat(ok('<DIV>x</div>').ast.body)).toBe('<DIV>x</DIV>')
    const card = ok('<user-card [userId]="x" user-name="y" />').ast.body[0] as Element
    expect(card.attrs.map((a) => [a.name, a.kind])).toEqual([
      ['userId', 'bind'],
      ['user-name', 'static'],
    ])
  })

  it('bindings', () => {
    const el = ok('<p [class.on]="a" [style.width.px]="w" [style.color]="c" hidden></p>').ast
      .body[0] as Element
    expect(el.attrs.map((a) => [a.kind, a.name, a.unit])).toEqual([
      ['class', 'on', undefined],
      ['style', 'width', 'px'],
      ['style', 'color', undefined],
      ['bare', 'hidden', undefined],
    ])
  })

  it('malformed', () => {
    expect(errors('<p>a<p>b')).toEqual([])
    expect(errors('</div>x')).toEqual([])
    for (const src of ['<a href="{{ x }}', 'x <a href={{ x }}>', '<div {{ a }}>', '<{{ t }}>']) {
      expect(errors(src).length, src).toBeGreaterThan(0)
    }
  })

  it('control flow', () => {
    const f = ok(
      '@for (item of items; track item.id; let i = $index, l = $last) { a } @empty { b }',
    ).ast.body[0]!
    expect(f.k).toBe('for')
    if (f.k !== 'for') return
    expect([f.item, f.lets, flat(f.empty!)]).toEqual(['item', { i: '$index', l: '$last' }, ' b '])
    const m = ok('@for ([k, v] of m) { x }').ast.body[0]!
    expect(m.k === 'for' && m.item).toEqual(['k', 'v'])
    const i = ok('@if (a; as b) { x } @else if (c) { y } @else { z }').ast.body[0]!
    expect(i.k === 'if' && i.branches.map((b) => b.alias ?? null)).toEqual(['b', null, null])
    expect(i.k === 'if' && i.branches[2]!.cond).toBeUndefined()
    expect(flat(ok("@switch (s) { @case ('a') { A } @default { D } }").ast.body)).toBe(
      '@switch[ A |default: D ]',
    )
    expect(flat(ok('@let t = a + b;').ast.body)).toBe('@let:t')
    expect(flat(ok("@slot('head') { x }").ast.body)).toBe('@slot:head[ x ]')
    expect(flat(ok('<slot name="foot">fb</slot><slot />').ast.body)).toBe(
      '<slot:foot>[fb]<slot:>[]',
    )
    expect(flat(ok("@assets('src/client/main.ts')").ast.body)).toBe('@assets:src/client/main.ts')
    expect(errors('@for (x in xs) { }')[0]!.message).toContain('of')
    expect(errors('@for (x of xs; let i = $nope) { }')[0]!.message).toContain('$nope')
    expect(errors('@if (a) { x').length).toBe(1)
  })

  it('script and style stay raw text inside svg and math', () => {
    expect(flat(ok('<svg><script>{{ x }}</script><style>{{ y }}</style></svg>').ast.body)).toBe(
      '<svg><script>{raw-text:x}</script><style>{raw-text:y}</style></svg>',
    )
    expect(flat(ok('<math><script>{{ x }}</script></math>').ast.body)).toBe(
      '<math><script>{raw-text:x}</script></math>',
    )
  })

  it('HTML rules resume at svg and math integration points', () => {
    const svg = ok(
      '<svg><foreignObject><textarea>{{ x }}</textarea><DIV></DIV></foreignObject></svg>',
    ).ast.body[0] as Element
    const fo = svg.children[0] as Element
    const [ta, div] = fo.children as Element[]
    expect([fo.foreign, ta!.foreign, div!.foreign]).toEqual([true, false, false])
    expect(flat([ta!])).toBe('<textarea>{rcdata:x}</textarea>')
    const desc = (ok('<svg><desc><b>x</b></desc></svg>').ast.body[0] as Element)
      .children[0] as Element
    expect((desc.children[0] as Element).foreign).toBe(false)
    const ann = (
      ok('<math><annotation-xml><p>x</p></annotation-xml></math>').ast.body[0] as Element
    ).children[0] as Element
    expect((ann.children[0] as Element).foreign).toBe(false)
  })

  it('ends raw text where a browser does', () => {
    // `</scriptx` doesn't close a script; the {{ }} after it is still script.
    expect(flat(ok('<script>a = "</scriptx>"; {{ x }}</script>').ast.body)).toBe(
      '<script>a = "</scriptx>"; {raw-text:x}</script>',
    )
    expect(flat(ok('<script>a</script >b').ast.body)).toBe('<script>a</script>b')
    // Content a browser parses differently from us is refused.
    expect(errors('<script>s = "<!--<script>"</script><p>{{ x }}</p>').length).toBeGreaterThan(0)
    expect(errors('<svg><script><![CDATA[ x ]]></script></svg>').length).toBeGreaterThan(0)
  })

  it('only HTML whitespace ends a raw-text close tag', () => {
    // U+00A0 isn't HTML whitespace: `</script\u00a0>` doesn't close the script.
    expect(flat(ok('<script>a</script\u00a0>b {{ x }}</script>').ast.body)).toBe(
      '<script>a</script\u00a0>b {raw-text:x}</script>',
    )
    expect(flat(ok('<script>a</script\t>b').ast.body)).toBe('<script>a</script>b')
  })

  it('refuses markup inside a foreign script or style', () => {
    for (const src of [
      '<svg><script><!-- </script> --></script></svg>',
      '<svg><script>if (a < b) {}</script></svg>',
      '<math><style><!-- x --></style></math>',
    ]) {
      expect(errors(src).length, src).toBeGreaterThan(0)
    }
    expect(errors('<svg><script>go()</script></svg>')).toEqual([])
  })

  it('positions survive CRLF and BOM', () => {
    const crlf = errors('﻿<p>\r\n{{ a() }}')[0]!
    const lf = errors('<p>\n{{ a() }}')[0]!
    expect(crlf.span.start).toMatchObject({ line: 2, column: 5 })
    expect(lf.span.start).toMatchObject({ line: 2, column: 5 })
  })
})

describe('fragments and stacks', () => {
  it('parses @fragment and @push blocks', () => {
    expect(flat(ok("@fragment('rows') {<b>x</b>}").ast.body)).toBe('@fragment:rows[<b>x</b>]')
    expect(flat(ok("@push('head') {<b>x</b>}").ast.body)).toBe('@push:head[<b>x</b>]')
  })

  it('keeps @fragment and @push without ( as text', () => {
    expect(flat(ok('a @push b').ast.body)).toBe('a @push b')
    expect(flat(ok('@fragment').ast.body)).toBe('@fragment')
  })

  it('refuses a fragment or stack name outside letters, digits, - and _', () => {
    expect(errors("@fragment('a b') {x}")).toHaveLength(1)
    expect(errors("@push('a/b') {x}")).toHaveLength(1)
    expect(errors('<stack name="a.b" />')).toHaveLength(1)
  })

  it('parses <stack name="head" />, self-closing or empty', () => {
    expect(flat(ok('<stack name="head" />').ast.body)).toBe('<stack:head>')
    expect(flat(ok('<stack name="head"></stack>').ast.body)).toBe('<stack:head>')
  })

  it('rejects a stack without a plain name', () => {
    expect(errors('<stack />')).toHaveLength(1)
    expect(errors('<stack name="{{ x }}" />')).toHaveLength(1)
  })

  it('leaves <stack-panel> an element', () => {
    expect(ok('<stack-panel></stack-panel>').ast.body[0]!.k).toBe('element')
  })
})

describe('slots that receive data', () => {
  it('parses lets on a fill, with renames, and the default slot', () => {
    const fill = ok("<x-a>@slot('row'; let user, u2 = index) {x}</x-a>").ast.body[0] as Element
    expect(fill.children[0]).toMatchObject({
      k: 'slot-fill',
      name: 'row',
      lets: [
        { name: 'user', from: 'user' },
        { name: 'u2', from: 'index' },
      ],
    })
    const def = ok('<x-a>@slot(default; let item) {x}</x-a>').ast.body[0] as Element
    expect(def.children[0]).toMatchObject({
      k: 'slot-fill',
      name: '',
      lets: [{ name: 'item', from: 'item' }],
    })
  })

  it('parses the values a <slot> offers, and refuses other static attributes', () => {
    const out = ok('<slot name="a" [user]="u" />').ast.body[0]
    expect(out).toMatchObject({ k: 'slot-outlet', name: 'a', offers: [{ name: 'user' }] })
    expect(errors('<slot name="a" foo="1" />')).toHaveLength(1)
  })
})

describe('snippets', () => {
  it('parses @snippet with params and defaults, and @render with arguments', () => {
    const body = ok(
      "@snippet badge(label, tone = 'info') {<b>{{ label }}</b>}\n@render badge(user.role, 'warn')",
    ).ast.body
    expect(body[0]).toMatchObject({
      k: 'snippet',
      name: 'badge',
      params: [{ name: 'label' }, { name: 'tone', default: 'info' }],
    })
    expect(body.find((n) => n.k === 'render')).toMatchObject({ k: 'render', name: 'badge' })
    expect((body.find((n) => n.k === 'render') as { args: unknown[] }).args).toHaveLength(2)
  })

  it('keeps @snippet and @render without a call as text', () => {
    expect(flat(ok('a @render b @snippet').ast.body)).toBe('a @render b @snippet')
  })

  it('refuses a snippet that is not at the top level', () => {
    expect(errors('<div>@snippet b() {x}</div>')).toHaveLength(1)
  })
})

describe('snippet defaults', () => {
  it('requires defaults to be trailing', () => {
    expect(errors('@snippet s(a = 1, b) {x}')).toHaveLength(1)
  })
})

describe('PR review parse fixes', () => {
  it('takes <slot [name]> as an offered value, not the selector', () => {
    expect(ok('<slot [name]="user.name" />').ast.body[0]).toMatchObject({
      k: 'slot-outlet',
      name: undefined,
      offers: [{ name: 'name' }],
    })
  })

  it('accepts a negative number default', () => {
    expect(ok('@snippet s(n = -1) {x}').ast.body[0]).toMatchObject({
      params: [{ name: 'n', default: -1 }],
    })
  })

  it("doesn't count a snippet body as page output before @layout", () => {
    ok('@snippet s() {<b>x</b>}\n@layout(none)\n<p></p>')
  })
})

describe('typed @input and @import type', () => {
  it('parses a type, brackets and all, before a default', () => {
    expect(ok('@input user: Map<string, A[]> = null\n<p></p>').ast.inputs[0]).toMatchObject({
      name: 'user',
      type: 'Map<string, A[]>',
      default: { value: null },
    })
    expect(ok('@input u: { a: string; b: number }\n<p></p>').ast.inputs[0]).toMatchObject({
      name: 'u',
      type: '{ a: string; b: number }',
    })
  })

  it('collects @import type lines', () => {
    expect(ok("@import type { User } from '@/domain/user'\n<p></p>").ast.typeImports).toEqual([
      "import type { User } from '@/domain/user'",
    ])
  })

  it('refuses a value import, and one inside an element', () => {
    expect(errors("@import { x } from 'y'")).toHaveLength(1)
    expect(errors("<div>@import type { X } from 'y'</div>")).toHaveLength(1)
  })

  it('keeps @import without type text as text', () => {
    expect(flat(ok('a @import b').ast.body)).toBe('a @import b')
  })
})
