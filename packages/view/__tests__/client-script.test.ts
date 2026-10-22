import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check'
import { parse } from '../src/parse/template'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

const TOAST_SCRIPT =
  "\nconst n: number = 1\ncustomElements.define('kick-toast', class extends HTMLElement {})\n"

function project(files: Record<string, string>) {
  const templates = new Map(
    Object.entries(files).map(([n, src]) => [n, parse(src, `${n}.kick`).ast]),
  )
  return { templates, pipes: new Set(BUILTIN_PIPES), componentsDir: 'components' }
}

const errors = (files: Record<string, string>, name: string) =>
  check(name, project(files))
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message)

describe('<script client>', () => {
  it('lifts the client script out of a component', () => {
    // The component (flash-toast) renders the custom element its script defines (kick-toast).
    const r = check(
      'components/flash-toast',
      project({
        'components/flash-toast': `<kick-toast><p>hi</p></kick-toast>\n<script client>${TOAST_SCRIPT}</script>`,
      }),
    )
    expect(r.template?.client).toEqual({ code: TOAST_SCRIPT, js: false })
    expect(JSON.stringify(r.template?.body)).not.toContain('<script')
    // Custom elements are expected next to a client script: no "isn't a component" warning.
    expect(r.diagnostics.map((d) => d.message).join('\n')).not.toContain("isn't a component")
  })

  it('other scripts stay inline', () => {
    const r = check(
      'components/a-b',
      project({ 'components/a-b': '<div></div>\n<script>let a = 1</script>' }),
    )
    expect(r.template?.client).toBeUndefined()
    expect(JSON.stringify(r.template?.body)).toContain('<script>')
  })

  it('refuses misplaced or impure client scripts', () => {
    expect(errors({ page: '<script client>let a = 1</script>' }, 'page')).toContain(
      '<script client> is only for components (src/views/components/…)',
    )
    expect(
      errors(
        { 'components/a-b': '<div><script client>let a = 1</script></div>' },
        'components/a-b',
      ),
    ).toContain('<script client> must be at the top level of the component')
    expect(
      errors(
        { 'components/a-b': '<div></div><script client>1</script><script client>2</script>' },
        'components/a-b',
      ),
    ).toContain('a component has one <script client>')
    expect(
      errors(
        { 'components/a-b': '<div></div><script client>let a = {{ x }}</script>' },
        'components/a-b',
      ),
    ).toContain("<script client> can't use {{ }} — pass data through attributes")
    for (const code of [
      "import { x } from './x'",
      "const m = await import('./m')",
      "export { y } from './y'",
    ])
      expect(
        errors(
          { 'components/a-b': `<div></div><script client>${code}</script>` },
          'components/a-b',
        ),
      ).toContain("client scripts can't import yet — keep the script self-contained")
  })
})
