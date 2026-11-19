/** The checker resolves each view root's references: its own first, then the app's. */
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import type { Project } from '../src/check/project'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

function project(files: Record<string, string>): Project {
  return {
    templates: new Map(
      Object.entries(files).map(([name, src]) => [name, parse(src, `${name}.kick`).ast]),
    ),
    pipes: new Set(BUILTIN_PIPES),
    componentsDir: 'components',
  }
}
const errors = (r: ReturnType<typeof check>) =>
  r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)

const LAYOUT = '<main><slot /></main>'

describe('checking view roots', () => {
  it("gives a root page's @layout the root's own layout first", () => {
    const p = project({
      'ui::layouts/main': LAYOUT,
      'layouts/main': LAYOUT,
      'ui::page': "@layout('layouts/main')\n<p>x</p>",
      page: "@layout('layouts/main')\n<p>x</p>",
    })
    expect(check('ui::page', p).template?.layout).toBe('ui::layouts/main')
    expect(check('page', p).template?.layout).toBe('layouts/main')
  })

  it("falls back to the app's layout, through a chain of layouts", () => {
    const p = project({
      'layouts/shell': LAYOUT,
      'ui::layouts/card': "@layout('layouts/shell')\n<div><slot /></div>",
      'ui::page': "@layout('layouts/card')\n<p>x</p>",
    })
    const r = check('ui::page', p)
    expect(errors(r)).toEqual([])
    expect(r.template?.layout).toBe('ui::layouts/card')
    expect(check('ui::layouts/card', p).template?.layout).toBe('layouts/shell')
  })

  it("uses a root's component by its prefixed tag", () => {
    const p = project({
      'ui::components/button': '<button><slot /></button>',
      page: '<ui-button>Go</ui-button>',
    })
    const r = check('page', p)
    expect(errors(r)).toEqual([])
    expect(JSON.stringify(r.template?.body)).toContain('"n":"ui::components/button"')
  })

  it('reports two templates that would share a tag', () => {
    const p = project({
      'components/ui/button': '<button></button>',
      'ui::components/button': '<button></button>',
      page: '<ui-button></ui-button>',
    })
    const msgs = errors(check('page', p)).join('\n')
    expect(msgs).toContain('components/ui/button')
    expect(msgs).toContain('ui::components/button')
  })

  it('names an unknown root in a layout reference', () => {
    const p = project({ page: "@layout('nope::x')\n<p></p>" })
    expect(errors(check('page', p)).join('\n')).toContain('nope::x')
  })
})

describe('checking view roots — PR review', () => {
  it('reports two components that would share a tag even when nothing uses it', () => {
    const p = project({
      'components/ui/button': '<button></button>',
      'ui::components/button': '<button></button>',
    })
    const msgs = errors(check('ui::components/button', p)).join('\n')
    expect(msgs).toContain('components/ui/button')
    expect(msgs).toContain('ui::components/button')
    expect(errors(check('components/ui/button', p)).join('\n')).toContain('ui::components/button')
  })
})
