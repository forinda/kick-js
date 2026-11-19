import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'
import { check, type CheckedTemplate } from '../src/check/check'
import { componentTag, templateName, type Project } from '../src/check/project'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

const BUILTINS = BUILTIN_PIPES

function project(
  files: Record<string, string>,
  pipes: string[] = [],
  layouts?: string | Record<string, string>,
  baseLayout?: string,
): Project {
  const templates = new Map(
    Object.entries(files).map(([name, src]) => [name, parse(src, `${name}.kick`).ast]),
  )
  return {
    templates,
    pipes: new Set([...BUILTINS, ...pipes]),
    componentsDir: 'components',
    layouts,
    baseLayout,
  }
}

const run = (files: Record<string, string>, name = 'page', pipes: string[] = []) =>
  check(name, project(files, pipes))
const errs = (files: Record<string, string>, name = 'page', pipes: string[] = []) =>
  run(files, name, pipes)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message)
const warns = (files: Record<string, string>, name = 'page') =>
  run(files, name)
    .diagnostics.filter((d) => d.severity === 'warning')
    .map((d) => d.message)
const clean = (files: Record<string, string>, name = 'page'): CheckedTemplate => {
  const r = run(files, name)
  expect(r.diagnostics).toEqual([])
  return r.template!
}

describe('check', () => {
  it('context errors', () => {
    const bad = [
      '<script>let a = {{ x }}</script>',
      '<style>a { color: {{ c }} }</style>',
      '<script type="application/json">{{ x }}</script>',
      '<button onclick="go({{ x }})">x</button>',
      '<p style="width: {{ w }}">x</p>',
      '<p class="a {{ c }}">x</p>',
      '<iframe srcdoc="{{ x }}"></iframe>',
      '<iframe [srcdoc]="x"></iframe>',
      '<meta http-equiv="refresh" content="0; url={{ u }}">',
      '<!-- {{ x }} -->',
      '<a href="{{ x | raw }}">x</a>',
      '<a [href]="x | raw">x</a>',
      '<p [onclick]="x">x</p>',
      '<p>{{ x | raw | uppercase }}</p>',
      '<a href="{{ a ? (x | raw) : y }}">x</a>',
      '<p>{{ a ? (x | raw) : y }}</p>',
      '<p>{{ (x | raw) + y }}</p>',
      '<p [title]="(x | raw) ?? y">x</p>',
      '<svg><set attributeName="href" to="{{ u }}" /></svg>',
      '<svg><animate attributeName="href" values="{{ u }}" /></svg>',
      '<svg><animate [attributeName]="n" values="a" /></svg>',
      '<svg><animateMotion [from]="u" /></svg>',
    ]
    for (const src of bad) expect(errs({ page: src }).length, src).toBeGreaterThan(0)
    expect(errs({ page: '<script type="application/json">{{ x | json }}</script>' })).toEqual([])
    expect(
      errs({ page: '<script type="application/ld+json">\n  {{ x | json }}\n</script>' }),
    ).toEqual([])
    expect(errs({ page: '<p>{{ x | raw }}</p><title>{{ t }}</title>' })).toEqual([])
  })

  it('a binding whose expression fails to parse is reported, not a crash', () => {
    for (const src of [
      '<li [class.on]="i == ==={= 0">x</li>',
      '<a [href]="(">x</a>',
      '<x-y [v]="a(" />',
    ]) {
      const files: Record<string, string> = { page: src, 'components/x-y': '@input v\n<p></p>' }
      const templates = new Map(Object.entries(files).map(([n, s]) => [n, parse(s, `${n}.kick`)]))
      expect(() =>
        check('page', {
          templates: new Map([...templates].map(([n, r]) => [n, r.ast])),
          pipes: new Set(BUILTINS),
          componentsDir: 'components',
        }),
      ).not.toThrow()
      expect(
        templates.get('page')!.diagnostics.some((d) => d.severity === 'error'),
        src,
      ).toBe(true)
    }
  })

  it('script attributes interpolate', () => {
    expect(run({ page: '<script src="{{ cdn }}" nonce="{{ n }}"></script>' }).diagnostics).toEqual(
      [],
    )
  })

  it('pipes', () => {
    expect(errs({ page: '{{ a | nope }}' })).toEqual(["unknown pipe 'nope'"])
    expect(errs({ page: '{{ a | upper }}' }, 'page', ['upper'])).toEqual([])
  })

  it('names', () => {
    expect(templateName('users/show')).toBe('users/show')
    for (const bad of ['../x', '/x', 'a\\b', 'a.kick', 'a//b', '', 'a/../b']) {
      expect(templateName(bad), bad).toBeUndefined()
    }
    expect(errs({ page: "@layout('../x')" })[0]).toContain('template name')
    expect(componentTag('components/forms/text-field', 'components')).toBe('forms-text-field')
  })

  it('layouts', () => {
    expect(errs({ page: "@layout('nope')" })[0]).toContain("layout 'nope'")
    const cyc = errs({ page: "@layout('a')", a: "@layout('b')<slot />", b: "@layout('a')<slot />" })
    expect(cyc[0]).toContain('a → b → a')
    expect(clean({ page: "@layout('main')x", main: '<slot />' }).layout).toBe('main')
    expect(clean({ page: '@layout(none)x' }).layout).toBe(null)
    expect(clean({ page: 'x' }).layout).toBeUndefined()
    expect(
      check('page', project({ page: 'x' }, [], 'nope')).diagnostics.map((d) => d.message)[0],
    ).toContain("layout 'nope'")
    expect(errs({ page: "@layout('main')\n@slot('nope') { x }", main: '<slot />' })[0]).toContain(
      "slot 'nope'",
    )
  })

  it('layout mappings and the base layout', () => {
    expect(
      check('admin/x', project({ 'admin/x': 'x' }, [], { admin: 'layouts/nope' })).diagnostics[0]
        ?.message,
    ).toContain("layout 'layouts/nope'")
    expect(
      check('page', project({ page: 'x' }, [], undefined, 'layouts/nope')).diagnostics[0]?.message,
    ).toContain("base layout 'layouts/nope'")
    // a fill reaching the base's outlet through a mapped layout
    expect(
      check(
        'admin/x',
        project(
          {
            'admin/x': "@slot('head') { t }x",
            'layouts/admin': '<slot />',
            'layouts/base': '<slot name="head" /><slot />',
          },
          [],
          { admin: 'layouts/admin' },
          'layouts/base',
        ),
      ).diagnostics,
    ).toEqual([])
    // no resolvable layout: a warning, not an error
    const r = check('page', project({ page: "@slot('head') { t }x" }))
    expect(r.template).toBeDefined()
    expect(r.diagnostics.map((d) => d.severity)).toEqual(['warning'])
  })

  it('components', () => {
    const card =
      '@input user\n@input compact = false\n<div class="card">{{ user.name }}<slot /></div>'
    expect(errs({ page: '<user-card [user]="u" />', 'components/user-card': card })).toEqual([])
    expect(errs({ page: '<user-card />', 'components/user-card': card })[0]).toContain(
      "missing input 'user'",
    )
    // Not an input: forwarded to the root element.
    expect(
      errs({ page: '<user-card [user]="u" nope="1" />', 'components/user-card': card }),
    ).toEqual([])
    // Fallthrough attributes are not inputs.
    expect(
      errs({
        page: '<user-card [user]="u" class="x" id="y" aria-label="z" data-k="1" [class.on]="a" />',
        'components/user-card': card,
      }),
    ).toEqual([])
    expect(
      errs({ page: '<two-roots class="x" />', 'components/two-roots': '<p></p><p></p>' })[0],
    ).toContain('one root element')
    expect(
      errs({ page: '<forms-x />', 'components/forms-x': 'a', 'components/forms/x': 'b' })[0],
    ).toContain('forms-x')
    expect(warns({ page: '<my-thing></my-thing>' })[0]).toContain('<my-thing>')
    expect(
      warns({ page: '<user-card [user]="u" compact="false" />', 'components/user-card': card })[0],
    ).toContain('"false"')
    // Any non-input falls through, checked as written on the root.
    for (const attr of ['href="{{ u }}"', '[href]="u"', 'onclick="x"', 'src="a"', 'data="x"']) {
      expect(errs({ page: `<x-a ${attr} />`, 'components/x-a': '<a>x</a>' }), attr).toEqual([])
    }
    // kebab-case binds the camelCase input
    expect(
      errs({ page: '<x-y user-id="1" />', 'components/x-y': '@input userId\n<p>{{ userId }}</p>' }),
    ).toEqual([])
  })

  it('slots', () => {
    const box = '<div><slot /><slot name="foot">fallback</slot></div>'
    expect(errs({ page: "<x-box>a @slot('foot') { b }</x-box>", 'components/x-box': box })).toEqual(
      [],
    )
    expect(
      errs({ page: "<x-box>@slot('nope') { b }</x-box>", 'components/x-box': box })[0],
    ).toContain("slot 'nope'")
    expect(
      errs({
        page: "<x-box>@slot('foot') { a } @slot('foot') { b }</x-box>",
        'components/x-box': box,
      })[0],
    ).toContain('twice')
  })

  it('scope', () => {
    expect(warns({ 'components/c': '@input a\n{{ a }}{{ note }}' }, 'components/c')[0]).toContain(
      "'note'",
    )
    // Slot content resolves in the caller's scope: no warning for `note` there.
    expect(
      run({ page: '<x-box>{{ note }}</x-box>', 'components/x-box': '<div><slot /></div>' })
        .diagnostics,
    ).toEqual([])
    expect(errs({ page: '{{ $index }}' })[0]).toContain('$index')
    expect(errs({ page: '@for (x of xs) { {{ $index }} {{ x }} }' })).toEqual([])
  })

  it('checks deeply nested markup without overflowing', () => {
    const deep = '<div>'.repeat(5000) + '{{ x }}' + '</div>'.repeat(5000)
    const r = run({ page: deep })
    expect(r.diagnostics).toEqual([])
    expect(r.template!.body.length).toBe(3)
    const comp = '<i>'.repeat(5000) + '<slot />' + '</i>'.repeat(5000)
    expect(errs({ page: '<x-d>a</x-d>', 'components/x-d': comp })).toEqual([])
  })

  it('optimize', () => {
    expect(clean({ page: '<p>a</p><p>b</p>' }).body).toEqual([{ k: 's', t: '<p>a</p><p>b</p>' }])
    expect(clean({ page: '<p class="a">x{{ y }}</p>' }).body).toEqual([
      { k: 's', t: '<p class="a">x' },
      { k: 'i', c: 'text', e: { k: 'd', n: 'y', p: [] }, at: [1, 15] },
      { k: 's', t: '</p>' },
    ])
  })
})

describe('stacks', () => {
  it('refuses <stack> in a component', () => {
    expect(errs({ 'components/x-y': '<stack name="a" /><b></b>' }, 'components/x-y')).toEqual([
      expect.stringContaining('components'),
    ])
  })

  it('warns about a stack named twice in one file', () => {
    expect(warns({ page: '<stack name="a" /><stack name="a" />' })).toEqual([
      expect.stringContaining("'a'"),
    ])
  })

  it('accepts @push in pages, layouts and components', () => {
    const push = '@push(\'head\') {<link rel="stylesheet" href="/a.css">}'
    clean({ page: push })
    clean({ 'layouts/main': `${push}<slot />` }, 'layouts/main')
    clean({ 'components/x-y': `${push}<b></b>` }, 'components/x-y')
  })
})

describe('fragments', () => {
  const frag = (src: string, name: string) => clean({ page: src }).fragments?.[name]

  it('refuses @fragment in a component, allows it in a layout', () => {
    expect(errs({ 'components/x-y': "@fragment('a') {<b></b>}" }, 'components/x-y')).toEqual([
      expect.stringContaining('components'),
    ])
    expect(
      clean({ 'layouts/main': "@fragment('a') {<slot />}" }, 'layouts/main').fragments?.a,
    ).toBeDefined()
  })

  it('refuses a fragment name used twice', () => {
    expect(errs({ page: "@fragment('a') {x}@fragment('a') {y}" })).toEqual([
      expect.stringContaining("'a'"),
    ])
  })

  it('needs the names enclosing blocks bind: @for, @if as, @let', () => {
    expect(
      frag(
        "@for (user of users; track user.id) {@fragment('row') {<tr>{{ user.name }}</tr>}}",
        'row',
      )?.needs,
    ).toEqual(['user'])
    expect(frag("@if (current; as u) {@fragment('me') {{{ u.name }}}}", 'me')?.needs).toEqual(['u'])
    expect(frag("@let total = a + b;\n@fragment('t') {{{ total }}}", 't')?.needs).toEqual(['total'])
  })

  it("doesn't need page data or names bound inside it", () => {
    expect(frag("@fragment('f') {{{ title }}}", 'f')?.needs).toEqual([])
    expect(frag("@fragment('f') {@for (x of xs; track x) {{{ x }}}}", 'f')?.needs).toEqual([])
  })

  it('compiles nested fragments: the inner needs only what is bound outside it', () => {
    const page = clean({
      page: "@for (g of groups; track g.id) {@fragment('group') {@for (u of g.users; track u.id) {@fragment('user') {{{ u.name }}{{ g.id }}}}}}",
    })
    expect(page.fragments?.group?.needs).toEqual(['g'])
    expect(page.fragments?.user?.needs).toEqual(['u', 'g'])
  })

  it("refuses an enclosing loop's $index, but needs its alias", () => {
    expect(errs({ page: "@for (x of xs; track x) {@fragment('f') {{{ $index }}}}" })).toEqual([
      expect.stringContaining('alias it'),
    ])
    expect(
      frag("@for (x of xs; track x; let i = $index) {@fragment('f') {{{ i }}}}", 'f')?.needs,
    ).toEqual(['i'])
  })

  it('leaves the inline markup as if the wrapper were not there', () => {
    const wrapped = clean({ page: "<p>@fragment('a') {<b>{{ t }}</b>}</p>" })
    const plain = clean({ page: '<p><b>{{ t }}</b></p>' })
    // Source positions differ; the markup doesn't.
    const noAt = (body: unknown) => JSON.stringify(body, (k, v) => (k === 'at' ? undefined : v))
    expect(noAt(wrapped.body)).toBe(noAt(plain.body))
  })

  it('reports a problem inside a fragment once', () => {
    expect(warns({ page: '@fragment(\'f\') {<stack name="a" /><stack name="a" />}' })).toHaveLength(
      1,
    )
  })
})

describe('stacks inside pushes', () => {
  it('refuses a <stack> inside @push', () => {
    expect(errs({ page: '@push(\'h\') {<stack name="z" />}' })).toEqual([
      expect.stringContaining('@push'),
    ])
  })
})

describe('review fixes', () => {
  it('accepts fragment names that are Object.prototype members', () => {
    const t = clean({
      page: "@fragment('constructor') {x}@fragment('__proto__') {y}@fragment('toString') {z}",
    })
    expect(Object.keys(t.fragments ?? {}).toSorted()).toEqual([
      '__proto__',
      'constructor',
      'toString',
    ])
  })

  it('refuses content in a <stack>, however the stack ends', () => {
    for (const page of [
      '<stack name="a">x</stack>',
      '<stack name="a">lost',
      '<div><stack name="a">lost</div>',
      '@if (t) {<stack name="a">lost}',
    ]) {
      expect(errs({ page }), page).toEqual([expect.stringContaining("can't have content")])
    }
    clean({ page: '<stack name="a">\n  </stack>' })
  })
})

describe('slots inside fragments and pushes', () => {
  it("finds a layout's slot inside its @fragment", () => {
    clean({
      'layouts/main': '@fragment(\'shell\') {<head><slot name="head" /></head><slot />}',
      page: "@layout('layouts/main')\n@slot('head') {<title>t</title>}\n<p>x</p>",
    })
  })

  it("finds a component's slot inside its @push", () => {
    clean({
      'components/x-box': '@push(\'h\') {<slot name="extra" />}<b>box</b>',
      page: "<x-box>@slot('extra') {<i>e</i>}</x-box>",
    })
  })
})

describe('passthrough', () => {
  const btn = { 'components/x-btn': '<button>go</button>' }

  it('forwards non-inputs, bindings included', () => {
    clean({ ...btn, page: '<x-btn type="submit" hx-post="/s" [disabled]="!ok" />' })
  })

  it('refuses an interpolated event handler, as on the root itself', () => {
    expect(errs({ ...btn, page: '<x-btn onclick="{{ js }}" />' })).toEqual([
      expect.stringContaining('onclick'),
    ])
  })

  it('warns about a name close to an input', () => {
    const c = { 'components/x-c': '@input compact = false\n<p>{{ compact }}</p>' }
    expect(warns({ ...c, page: '<x-c compcat />' })).toEqual([
      expect.stringContaining("did you mean 'compact'"),
    ])
    expect(warns({ ...c, page: '<x-c hx-get="/a" />' })).toEqual([])
  })

  it('refuses guarded names on a form-field root', () => {
    const input = { 'components/x-in': '<input name="pw">' }
    for (const attr of [
      'type="password"',
      'name="x"',
      'value="v"',
      'checked',
      'validate="required"',
    ]) {
      expect(errs({ ...input, page: `<x-in ${attr} />` }), attr).toEqual([
        expect.stringContaining('@input'),
      ])
    }
  })

  it('refuses attributes for a <slot> root', () => {
    expect(errs({ 'components/x-s': '<slot />', page: '<x-s x="1" />' })).toEqual([
      expect.stringContaining('x'),
    ])
  })

  it('lets a client-script component with one element take attributes', () => {
    clean({
      'components/x-k': '<b>k</b>\n<script client>customElements.get("x-b")</script>',
      page: '<x-k hx-get="/a" />',
    })
  })

  it('names the forwarded attributes when there are several roots', () => {
    expect(errs({ 'components/x-2': '<p></p><p></p>', page: '<x-2 hx-get="/a" />' })).toEqual([
      expect.stringContaining('hx-get'),
    ])
  })
})

describe('wrapper components', () => {
  it('refuses guarded names on a form field at the end of the chain', () => {
    expect(
      errs({
        'components/x-in': '<input name="pw">',
        'components/x-w': '<x-in />',
        page: '<x-w type="password" />',
      }),
    ).toEqual([expect.stringContaining('@input')])
  })

  it("leaves a wrapper's missing inner input to the wrapper's own check", () => {
    const files = {
      'components/ui-b': '@input size\n<b>{{ size }}</b>',
      'components/x-w': '<ui-b />',
      page: '<x-w size="lg" />',
    }
    expect(errs(files, 'components/x-w')).toEqual([expect.stringContaining("missing input 'size'")])
  })
})
