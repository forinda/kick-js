/**
 * The types behind a checked `ctx.render(name, data)`: `kick typegen` fills
 * {@link KickViews} from the app's `.kick` templates, and the render
 * signatures read it. While it's empty — no typegen, or no `.kick` views —
 * `ctx.render` takes any name and any data, as before.
 *
 * @module @forinda/kickjs/http/view-types
 * @see https://kickjs.app/guide/views/typed-render-data
 */
import type { ViewRenderOptions } from './view-renderer'

/**
 * Every `.kick` page by name: the data it reads and its fragments' needs.
 * Filled by `kick typegen`; don't write entries by hand.
 *
 * @see https://kickjs.app/guide/views/typed-render-data
 */
export interface KickViews {}

/**
 * Names `createViews({ share })` supplies to every page, so a controller
 * needn't pass them. Declare them once:
 *
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface KickViewShared { user: User | undefined; csrfToken: string }
 * }
 * ```
 *
 * @see https://kickjs.app/guide/views/typed-render-data
 */
export interface KickViewShared {}

/**
 * Switches for the render types. `otherEngines: true` lets names outside
 * {@link KickViews} through — for an app that also renders EJS or Pug with
 * `ViewAdapter` (a misspelled `.kick` name then compiles too).
 *
 * @see https://kickjs.app/guide/views/typed-render-data
 */
export interface KickViewTypeOptions {}

type Opts = Omit<ViewRenderOptions, 'fragment'>

/** Template names `R` knows, `string` while it's empty or other engines are on. */
export type ViewNameOf<R, O> = [keyof R] extends [never]
  ? string
  : O extends { otherEngines: true }
    ? string
    : Extract<keyof R, string>

type DataOf<R, N> = N extends keyof R ? (R[N] extends { data: infer D } ? D : never) : never

type Intersect<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never

/**
 * Shared names may be left out; extra keys are fine. The union keeps an
 * interface or class instance assignable (they have no index signature),
 * while an object literal's extra keys are allowed by the second member.
 */
type Shaped<D, S> = Omit<D, keyof S> & Partial<Pick<D, Extract<keyof D, keyof S>>>
type WithShared<D, S> = Shaped<D, S> | (Shaped<D, S> & Record<string, unknown>)

/** The data `ctx.render(N, data)` takes; for a union of names, what every one of those pages needs. */
export type ViewDataOf<R, S, N> = [DataOf<R, N>] extends [never]
  ? Record<string, any>
  : WithShared<Intersect<DataOf<R, N>>, S>

type FragmentsOf<R, N> = N extends keyof R ? (R[N] extends { fragments: infer F } ? F : {}) : never

/** A fragment name of page `N` (any string for names the registry doesn't know). */
export type ViewFragmentNameOf<R, N> = [FragmentsOf<R, N>] extends [never]
  ? string
  : Extract<keyof FragmentsOf<R, N>, string>

/** What `opts.fragment` may be: one fragment of page `N`, or a list of them. */
export type FragmentNames<R, N> = ViewFragmentNameOf<R, N> | readonly ViewFragmentNameOf<R, N>[]

type Part<R, N, K, P extends 'needs' | 'reads'> = K extends keyof FragmentsOf<R, N>
  ? FragmentsOf<R, N>[K] extends Record<P, infer X>
    ? X
    : never
  : never
type Listed<F> = F extends readonly (infer X)[] ? X : F

/**
 * The data a fragment render takes: for every fragment named, its needs
 * exactly (the controller passes them; `share()` doesn't count at render),
 * plus the page data it reads.
 */
export type ViewFragmentDataOf<R, S, N, F> = [FragmentsOf<R, N>] extends [never]
  ? Record<string, any>
  : Intersect<Part<R, N, Listed<F>, 'needs'>> &
      WithShared<Intersect<Part<R, N, Listed<F>, 'reads'>>, S>

/**
 * The arguments after the name, without a fragment: `data` (required when
 * the page needs any) and options. Fragment renders have their own overload.
 */
export type RenderArgs<R, S, N> = [DataOf<R, N>] extends [never]
  ? // A name the registry doesn't know (an empty registry, another engine): as before.
    [data?: Record<string, any>, opts?: Opts & { fragment?: string | readonly string[] }]
  : {} extends ViewDataOf<R, S, N>
    ? [data?: ViewDataOf<R, S, N>, opts?: Opts & { fragment?: undefined }]
    : [data: ViewDataOf<R, S, N>, opts?: Opts & { fragment?: undefined }]

/**
 * What name `N` the loose overload takes: any string while the registry is
 * empty (so generic helpers compile); with other engines on, any name but a
 * registered one — a known page can't skip its data through it; else none.
 */
export type LooseViewNameOf<R, O, N> = [keyof R] extends [never]
  ? string
  : O extends { otherEngines: true }
    ? N extends keyof R
      ? never
      : string
    : never

/** The app's template names. */
export type ViewName = ViewNameOf<KickViews, KickViewTypeOptions>
/** The data page `N` takes. */
export type ViewData<N> = ViewDataOf<KickViews, KickViewShared, N>
/** Arguments after the name, for the app's registry. */
export type ViewRenderArgs<N> = RenderArgs<KickViews, KickViewShared, N>
/** `opts.fragment` for page `N`. */
export type ViewFragmentNames<N> = FragmentNames<KickViews, N>
/** The data a fragment render of page `N` takes. */
export type ViewFragmentData<N, F> = ViewFragmentDataOf<KickViews, KickViewShared, N, F>
/** The loose overload's name, for the app's registry. */
export type LooseViewName<N> = LooseViewNameOf<KickViews, KickViewTypeOptions, N>
