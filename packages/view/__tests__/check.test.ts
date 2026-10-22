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
    expect(
      errs({ page: '<user-card [user]="u" nope="1" />', 'components/user-card': card })[0],
    ).toContain("unknown input 'nope'")
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
    // Only class/id/style/role/aria-*/data-* fall through; a URL or event attribute is an unknown input.
    for (const attr of ['href="{{ u }}"', '[href]="u"', 'onclick="x"', 'src="a"', 'data="x"']) {
      expect(errs({ page: `<x-a ${attr} />`, 'components/x-a': '<a>x</a>' })[0], attr).toContain(
        'unknown input',
      )
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

  it('optimize', () => {
    expect(clean({ page: '<p>a</p><p>b</p>' }).body).toEqual([{ k: 's', t: '<p>a</p><p>b</p>' }])
    expect(clean({ page: '<p class="a">x{{ y }}</p>' }).body).toEqual([
      { k: 's', t: '<p class="a">x' },
      { k: 'i', c: 'text', e: { k: 'd', n: 'y', p: [] }, at: [1, 15] },
      { k: 's', t: '</p>' },
    ])
  })
})
