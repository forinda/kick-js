/**
 * Coverage for `stripDevtoolsCode` — the pure transform that drops
 * devtools-kit imports + their top-level call sites from production
 * bundles. Spec: docs/db/m3-plan.md §M3.C.
 */

import { describe, expect, it } from 'vitest'
import { stripDevtoolsCode } from '../src/babel-strip-devtools'

const ID = '/project/src/foo.ts'

function strip(source: string) {
  return stripDevtoolsCode(source, ID, { fastReject: false })
}

describe('stripDevtoolsCode', () => {
  it('removes a named import from devtools-kit', () => {
    const src = `
      import { defineDevtoolsRenderTab } from '@forinda/kickjs-devtools-kit'
      export const x = 1
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(true)
    expect(code).not.toContain('kickjs-devtools-kit')
    expect(code).not.toContain('defineDevtoolsRenderTab')
    expect(code).toContain('export const x = 1')
  })

  it('removes a side-effect import from a devtools-kit sub-path', () => {
    const src = `
      import '@forinda/kickjs-devtools-kit/bus'
      export const x = 1
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(true)
    expect(code).not.toContain('kickjs-devtools-kit')
  })

  it('removes side-effect imports whose path ends in /devtools-events', () => {
    const src = `
      import '@forinda/kickjs-db/devtools-events'
      import './devtools-events'
      export const x = 1
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(true)
    expect(code).not.toMatch(/devtools-events/)
    expect(code).toContain('export const x = 1')
  })

  it('removes top-level defineDevtoolsRenderTab() calls bound from devtools-kit', () => {
    const src = `
      import { defineDevtoolsRenderTab } from '@forinda/kickjs-devtools-kit'
      defineDevtoolsRenderTab({ id: 'x', name: 'X', render: () => undefined })
      export const x = 1
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(true)
    expect(code).not.toContain('defineDevtoolsRenderTab')
    expect(code).toContain('export const x = 1')
  })

  it('removes member-access calls rooted in a devtools-kit binding', () => {
    const src = `
      import * as devtools from '@forinda/kickjs-devtools-kit'
      devtools.defineDevtoolsRenderTab({ id: 'x' })
      export const x = 1
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(true)
    expect(code).not.toContain('devtools.defineDevtoolsRenderTab')
    expect(code).toContain('export const x = 1')
  })

  it('does NOT touch identifiers imported from elsewhere', () => {
    const src = `
      import { defineDevtoolsRenderTab } from './my-local-helpers'
      defineDevtoolsRenderTab({ id: 'x' })
      export const x = 1
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(false)
    expect(code).toContain('defineDevtoolsRenderTab')
  })

  it('leaves non-top-level references alone (signal to gate behind __KICKJS_DEVTOOLS__)', () => {
    // The call inside `setup` survives — after the import is dropped
    // it becomes a dangling reference and the build will fail loud.
    const src = `
      import { defineDevtoolsRenderTab } from '@forinda/kickjs-devtools-kit'
      export function setup() {
        defineDevtoolsRenderTab({ id: 'x' })
      }
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(true)
    expect(code).not.toContain("from '@forinda/kickjs-devtools-kit'")
    // The reference inside the function body stays — the build fails
    // loud if it's not gated, which is the intended signal.
    expect(code).toContain('defineDevtoolsRenderTab(')
  })

  it('returns unchanged source when no devtools imports are present', () => {
    const src = `
      import { foo } from 'bar'
      foo()
      export const x = 1
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(false)
    expect(code).toBe(src)
  })

  it('fast-reject short-circuits files that lack the devtools-kit substring', () => {
    const src = `import { foo } from 'bar'\nexport const x = 1\n`
    // fastReject defaults to true — does not even invoke Babel.
    const { code, changed } = stripDevtoolsCode(src, ID)
    expect(changed).toBe(false)
    expect(code).toBe(src)
  })

  it('parses TSX files with embedded JSX without crashing', () => {
    const tsx = `
      import { defineDevtoolsRenderTab } from '@forinda/kickjs-devtools-kit'
      defineDevtoolsRenderTab({
        id: 'demo',
        render: () => null,
      })
      export const Component = () => <div className="x">hi</div>
    `
    const { code, changed } = stripDevtoolsCode(tsx, '/project/src/Component.tsx', {
      fastReject: false,
    })
    expect(changed).toBe(true)
    expect(code).not.toContain('@forinda/kickjs-devtools-kit')
    expect(code).not.toContain('defineDevtoolsRenderTab(')
    // JSX in the function body survives — only the imported binding's
    // top-level call site got stripped.
    expect(code).toContain('export const Component')
  })

  it('handles `.ts` files with angle-bracket type assertions', () => {
    // The jsx plugin is intentionally OFF for plain .ts files —
    // mixing `jsx` + `typescript` would break `<T>x` cast syntax.
    const ts = `
      import { defineDevtoolsRenderTab } from '@forinda/kickjs-devtools-kit'
      defineDevtoolsRenderTab({ id: 'x' })
      export const cast = <number>(0 as unknown)
    `
    const { code, changed } = stripDevtoolsCode(ts, '/project/src/util.ts', {
      fastReject: false,
    })
    expect(changed).toBe(true)
    expect(code).not.toContain('@forinda/kickjs-devtools-kit')
    expect(code).toContain('<number>')
  })

  it('handles multiple devtools-kit imports in one file', () => {
    const src = `
      import { defineDevtoolsRenderTab } from '@forinda/kickjs-devtools-kit'
      import { KickEventBus } from '@forinda/kickjs-devtools-kit/bus'
      defineDevtoolsRenderTab({ id: 'a' })
      const bus: KickEventBus | null = null
      export { bus }
    `
    const { code, changed } = strip(src)
    expect(changed).toBe(true)
    expect(code).not.toContain('@forinda/kickjs-devtools-kit')
    expect(code).not.toContain('defineDevtoolsRenderTab(')
  })
})
