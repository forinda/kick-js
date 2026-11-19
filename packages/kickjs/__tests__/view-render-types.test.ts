/**
 * The typed `ctx.render` surface. The helpers take the registry as a type
 * parameter, so these tests use local registries: augmenting the real
 * `KickViews` here would apply to every file in the type-check program.
 * (typegen-e2e.test.ts in the view package covers the real augmentation.)
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { RequestContext } from '../src'
import type {
  FragmentNames,
  LooseViewNameOf,
  RenderArgs,
  ViewFragmentDataOf,
  ViewNameOf,
} from '../src/http/view-types'

interface Reg {
  'users/show': {
    data: { user: { name: unknown }; title?: unknown }
    fragments: {
      row: { needs: { post: unknown; title: unknown }; reads: {} }
      count: { needs: { n: unknown }; reads: {} }
    }
  }
  home: { data: { title?: unknown }; fragments: {} }
  a: { data: { x: string }; fragments: {} }
  b: { data: { y: number }; fragments: {} }
}
interface Shared {
  title: string
}
type Name = ViewNameOf<Reg, {}>
// The overload set ctx.render has, over the local registry.
declare function render<N extends Name>(name: N, ...args: RenderArgs<Reg, Shared, N>): void
declare function render<N extends Name, const F extends FragmentNames<Reg, N>>(
  name: N,
  data: ViewFragmentDataOf<Reg, Shared, N, F>,
  opts: { fragment: F },
): void
type Engines = { otherEngines: true }
declare function renderLoose<N extends ViewNameOf<Reg, Engines>>(
  name: N,
  ...args: RenderArgs<Reg, Shared, N>
): void
declare function renderLoose<N extends string>(
  name: N & LooseViewNameOf<Reg, Engines, N>,
  data?: Record<string, any>,
): void

describe('typed render', () => {
  it('checks names and data', () => {
    // Type-checked, never run: `render` is only declared.
    const types = () => {
      render('users/show', { user: { name: 'a' } })
      // Extra keys are fine; a shared name may be left out.
      render('users/show', { user: { name: 'a' }, extra: 1 })
      render('home')
      // @ts-expect-error a missing required name
      render('users/show', {})
      // @ts-expect-error data the page needs, left out entirely
      render('users/show')
      // @ts-expect-error a misspelled template
      render('users/shwo', { user: { name: 'a' } })
    }
    void types
    expectTypeOf<Name>().toEqualTypeOf<'users/show' | 'home' | 'a' | 'b'>()
  })

  it('requires what every page of a union name needs', () => {
    const types = (n: 'a' | 'b') => {
      render(n, { x: 's', y: 1 })
      // @ts-expect-error y is needed by b
      render(n, { x: 's' })
      // @ts-expect-error both pages need data
      render(n)
    }
    void types
  })

  it("narrows a fragment render to the fragment's needs, all of them for a list", () => {
    const types = () => {
      render('users/show', { post: 1, title: 't' }, { fragment: 'row' })
      render('users/show', { post: 1, title: 't', n: 2 }, { fragment: ['row', 'count'] })
      // @ts-expect-error count needs n
      render('users/show', { post: 1, title: 't' }, { fragment: ['row', 'count'] })
      // @ts-expect-error a need named like a shared key is still needed (share() doesn't count)
      render('users/show', { post: 1 }, { fragment: 'row' })
      // @ts-expect-error the fragment needs post
      render('users/show', {}, { fragment: 'row' })
      // @ts-expect-error no such fragment
      render('users/show', { post: 1, title: 't' }, { fragment: 'nope' })
    }
    void types
  })

  it('lets other engines’ names through when the app opts in, but not past a known page', () => {
    const types = () => {
      renderLoose('legacy.ejs', { anything: 1 })
      renderLoose('users/show', { user: { name: 'a' } })
      // @ts-expect-error .kick names still get checked data
      renderLoose('users/show', {})
      // @ts-expect-error nor can they skip it through the loose overload
      renderLoose('users/show')
    }
    void types
  })

  it('stays loose with the real, empty registry', () => {
    const ctx = {} as RequestContext
    const name = 'x' as string
    const data: Record<string, any> = {}
    expectTypeOf(ctx.render).toBeFunction()
    const types = () => {
      ctx.render(name, data)
      ctx.render(name)
      ctx.render('anything', { a: 1 }, { layout: false, fragment: 'f' })
    }
    // A generic helper over names, with no registry.
    function helper<T extends string>(c: RequestContext, n: T, d: Record<string, any>) {
      return c.render(n, d)
    }
    void types
    void helper
  })
})
