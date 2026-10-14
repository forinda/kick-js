/**
 * Prop wrappers that change when a prop is sent. A plain value or a function
 * is sent on every full visit and on a partial reload that asks for it; a
 * function is only called when the prop is actually sent.
 *
 * @module @forinda/kickjs-inertia/props
 */

type Resolver<T> = T | (() => T | Promise<T>)

const PROP = Symbol.for('kickjs.inertia.prop')

export type PropKind = 'optional' | 'always' | 'defer' | 'merge' | 'once' | 'scroll'

/** Where an infinite-scroll prop is in its pages; `null` past either end. */
export interface ScrollMeta {
  currentPage: number | string | null
  nextPage: number | string | null
  previousPage: number | string | null
}

export interface InertiaProp<T = unknown> {
  readonly [PROP]: PropKind
  readonly value: Resolver<T>
  /** `defer` only — props in one group load in one request. */
  readonly group?: string
  /** `merge` only — append, prepend or deep-merge into the client's copy. */
  readonly mode?: 'append' | 'prepend' | 'deep'
  /** `merge` and `scroll` — item fields that identify a row, e.g. `['id']`. */
  readonly matchOn?: string[]
  /** `once` only — the name the client caches it under. */
  readonly key?: string
  /** `once` only — milliseconds the client may keep it. */
  readonly ttl?: number
  /** `scroll` only. */
  readonly pageName?: string
  readonly wrapper?: string
  readonly meta?: (value: any) => ScrollMeta
}

function prop<T>(kind: PropKind, value: Resolver<T>, extra?: object): InertiaProp<T> {
  return { [PROP]: kind, value, ...extra }
}

/** Sent only when a partial reload names it (`router.reload({ only: [...] })`). */
export function optional<T>(value: () => T | Promise<T>): InertiaProp<T> {
  return prop('optional', value)
}

/** Sent on every response, including partial reloads that did not name it. */
export function always<T>(value: Resolver<T>): InertiaProp<T> {
  return prop('always', value)
}

/**
 * Left out of the first response; the client fetches it right after the page
 * renders, one request per `group`.
 */
export function defer<T>(value: () => T | Promise<T>, group = 'default'): InertiaProp<T> {
  return prop('defer', value, { group })
}

/**
 * Merged into the client's current value on a partial reload instead of
 * replacing it — paginated lists, infinite scroll.
 */
export function merge<T>(
  value: Resolver<T>,
  mode: 'append' | 'prepend' | 'deep' = 'append',
  options: { matchOn?: string | string[] } = {},
): InertiaProp<T> {
  return prop('merge', value, { mode, matchOn: toList(options.matchOn) })
}

/**
 * Resolved once, then kept by the client: later visits skip it until `ttl`
 * runs out. For data that rarely changes — plans, countries, a settings
 * list. Pages that share a `key` share the cached value.
 */
export function once<T>(
  value: Resolver<T>,
  options: { key?: string; ttl?: number } = {},
): InertiaProp<T> {
  return prop('once', value, options)
}

/**
 * One page of an infinite list, for Inertia's `<InfiniteScroll>`. The client
 * asks for the next or previous page with `?page=N` and appends or prepends
 * the rows under `wrapper`.
 *
 * The value is read as `{ data, meta: { page, hasNext, hasPrev } }` — the
 * `PaginatedResponse` shape; pass `meta` to read another one.
 */
export function scroll<T>(
  value: Resolver<T>,
  options: {
    pageName?: string
    wrapper?: string
    matchOn?: string | string[]
    meta?: (value: T) => ScrollMeta
  } = {},
): InertiaProp<T> {
  return prop('scroll', value, {
    pageName: options.pageName ?? 'page',
    wrapper: options.wrapper ?? 'data',
    matchOn: toList(options.matchOn),
    meta: options.meta ?? paginatedMeta,
  })
}

function toList(value: string | string[] | undefined): string[] | undefined {
  return value === undefined ? undefined : Array.isArray(value) ? value : [value]
}

function paginatedMeta(value: unknown): ScrollMeta {
  const meta = (value as { meta?: { page?: number; hasNext?: boolean; hasPrev?: boolean } })?.meta
  if (typeof meta?.page !== 'number') {
    throw new Error(
      'scroll(): the value has no `meta.page` — return `{ data, meta: { page, hasNext, hasPrev } }` or pass `meta`.',
    )
  }
  return {
    currentPage: meta.page,
    nextPage: meta.hasNext ? meta.page + 1 : null,
    previousPage: meta.hasPrev ? meta.page - 1 : null,
  }
}

export function isInertiaProp(value: unknown): value is InertiaProp {
  return typeof value === 'object' && value !== null && PROP in value
}

export function propKind(value: InertiaProp): PropKind {
  return value[PROP]
}

/** Unwrap a wrapper, call a function, await a promise. */
export async function resolveProp(value: unknown): Promise<unknown> {
  const raw = isInertiaProp(value) ? value.value : value
  return typeof raw === 'function' ? await (raw as () => unknown)() : await raw
}
