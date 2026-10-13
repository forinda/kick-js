/**
 * Prop wrappers that change when a prop is sent. A plain value or a function
 * is sent on every full visit and on a partial reload that asks for it; a
 * function is only called when the prop is actually sent.
 *
 * @module @forinda/kickjs-inertia/props
 */

type Resolver<T> = T | (() => T | Promise<T>)

const PROP = Symbol.for('kickjs.inertia.prop')

export type PropKind = 'optional' | 'always' | 'defer' | 'merge'

export interface InertiaProp<T = unknown> {
  readonly [PROP]: PropKind
  readonly value: Resolver<T>
  /** `defer` only — props in one group load in one request. */
  readonly group?: string
  /** `merge` only — append, prepend or deep-merge into the client's copy. */
  readonly mode?: 'append' | 'prepend' | 'deep'
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
): InertiaProp<T> {
  return prop('merge', value, { mode })
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
