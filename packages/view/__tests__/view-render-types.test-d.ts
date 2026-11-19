/** Typed `views.render`, with a local registry (augmenting the real one would apply to every file). */
import { expectTypeOf, test } from 'vitest'
import type { FragmentNames, RenderArgs, ViewFragmentDataOf, ViewNameOf } from '../src/types'
import type { Views } from '../src/index'

interface Reg {
  page: {
    data: { user: { name: unknown } }
    fragments: { row: { needs: { u: unknown }; reads: {} } }
  }
}
type Name = ViewNameOf<Reg, {}>
declare function render<N extends Name>(name: N, ...args: RenderArgs<Reg, {}, N>): void
declare function render<N extends Name, const F extends FragmentNames<Reg, N>>(
  name: N,
  data: ViewFragmentDataOf<Reg, {}, N, F>,
  opts: { fragment: F; ctx?: unknown },
): void

test('typed views.render', () => {
  render('page', { user: { name: 1 } })
  render('page', { u: 1 }, { fragment: 'row', ctx: {} })
  // @ts-expect-error missing user
  render('page', {})
  // @ts-expect-error unknown template
  render('pag', { user: { name: 1 } })
})

test('the real, empty registry stays loose', () => {
  const views = {} as Views
  expectTypeOf(views.render('anything', { a: 1 }, { layout: false })).toEqualTypeOf<
    Promise<string>
  >()
})
