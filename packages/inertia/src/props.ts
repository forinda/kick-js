import { DEFERRED_PROP, OPTIONAL_PROP, ALWAYS_PROP, TO_BE_MERGED } from './symbols'

export interface DeferredProp<T = any> {
  (): T | Promise<T>
  [DEFERRED_PROP]: true
  _group: string | undefined
}

export interface OptionalProp<T = any> {
  (): T | Promise<T>
  [OPTIONAL_PROP]: true
}

export interface AlwaysProp<T = any> {
  value: T
  [ALWAYS_PROP]: true
}

export interface MergeProp<T = any> {
  value: T
  [TO_BE_MERGED]: true
}

export function defer<T>(fn: () => T | Promise<T>, group?: string): DeferredProp<T> {
  const prop = fn as DeferredProp<T>
  prop[DEFERRED_PROP] = true
  prop._group = group
  return prop
}

export function optional<T>(fn: () => T | Promise<T>): OptionalProp<T> {
  const prop = fn as OptionalProp<T>
  prop[OPTIONAL_PROP] = true
  return prop
}

export function always<T>(value: T): AlwaysProp<T> {
  return { value, [ALWAYS_PROP]: true } as AlwaysProp<T>
}

export function merge<T>(value: T): MergeProp<T> {
  return { value, [TO_BE_MERGED]: true } as MergeProp<T>
}
