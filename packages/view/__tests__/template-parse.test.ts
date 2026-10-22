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
