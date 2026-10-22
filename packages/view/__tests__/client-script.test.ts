import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createViews } from '../src/index'
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

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-client-'))
  for (const [name, src] of Object.entries(files)) {
    const file = join(root, `${name}.kick`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, src)
  }
  return root
}

const TOAST = `<kick-toast><p>hi</p></kick-toast>\n<script client>${TOAST_SCRIPT}</script>`
const TAG =
  /<script type="module" src="\/_kick\/c\/flash-toast\.[0-9a-f]{8}\.js"( nonce="[^"]*")?><\/script>/g

describe('pages ship client scripts', () => {
  const views = (pages: Record<string, string>, opts = {}) =>
    createViews({
      viewsDir: dir({ 'components/flash-toast': TOAST, ...pages }),
      warn: vi.fn(),
      ...opts,
    })

  it('only rendered components ship their script', async () => {
    const v = views({ page: '<html><body>@if (show) { <flash-toast /> }</body></html>' })
    expect(await v.render('page', { show: false })).not.toContain('<script')
    const html = await v.render('page', { show: true })
    expect(html.match(TAG)).toHaveLength(1)
    expect(html).toMatch(/<\/script><\/body><\/html>$/)
  })

  it('one tag per component, from pages, layouts and components', async () => {
    const v = views({
      'layouts/main': '<html><body><flash-toast /><slot /></body></html>',
      'components/toast-box': '<div><flash-toast /></div>',
      page: "@layout('layouts/main')\n@for (i of items; track i) { <flash-toast /> }<toast-box />",
    })
    expect((await v.render('page', { items: [1, 2, 3] })).match(TAG)).toHaveLength(1)
  })

  it('serves the stripped script by its hashed name', async () => {
    const v = views({ page: '<flash-toast />' })
    const file = (await v.render('page')).match(/flash-toast\.[0-9a-f]{8}\.js/)![0]
    const js = await v.clientScript(file)
    expect(js).toContain("customElements.define('kick-toast'")
    expect(js).not.toContain(': number')
    expect(await v.clientScript('flash-toast.00000000.js')).toBeUndefined()
    expect(await v.clientScript('../x.js')).toBeUndefined()
  })

  it("adds the page's nonce", async () => {
    const v = views({ page: '<flash-toast />' })
    expect(await v.render('page', { cspNonce: 'abc' })).toContain('nonce="abc"')
  })

  it('a missing type stripper only fails pages that need it', async () => {
    const message = 'client scripts need Node 22.13+ to strip TypeScript, or a kick build'
    const v = views(
      { page: '<flash-toast />', plain: '<p>ok</p>' },
      {
        stripTypes: () => {
          throw new Error(message)
        },
      },
    )
    await expect(v.render('page')).rejects.toThrow(message)
    expect(await v.render('plain')).toBe('<p>ok</p>')
  })
})
