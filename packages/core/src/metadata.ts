import 'reflect-metadata'

/**
 * Typed utilities for reflect-metadata operations.
 *
 * Replaces scattered Reflect.defineMetadata/getMetadata calls with a single
 * source of truth. If we later move to Stage 3 decorators or a WeakMap-based
 * store, only this file changes — all 24+ consumer files stay untouched.
 */

type MetaKey = symbol | string

// ── Setters ─────────────────────────────────────────────────────

/** Set metadata on a class (or prototype for property decorators) */
export function setClassMeta<T>(key: MetaKey, value: T, target: object): void {
  Reflect.defineMetadata(key, value, target)
}

/** Set metadata on a specific method */
export function setMethodMeta<T>(key: MetaKey, value: T, target: object, method: string): void {
  Reflect.defineMetadata(key, value, target, method)
}

// ── Getters ─────────────────────────────────────────────────────

/** Get metadata from a class, returning `fallback` if not set */
export function getClassMeta<T>(key: MetaKey, target: object, fallback: T): T {
  return (Reflect.getMetadata(key, target) as T) ?? fallback
}

/** Get metadata from a specific method, returning `fallback` if not set */
export function getMethodMeta<T>(key: MetaKey, target: object, method: string, fallback: T): T {
  return (Reflect.getMetadata(key, target, method) as T) ?? fallback
}

/** Check if metadata exists on a class */
export function hasClassMeta(key: MetaKey, target: object): boolean {
  return Reflect.hasMetadata(key, target)
}

/** Get metadata from a class with no default (returns undefined if absent) */
export function getClassMetaOrUndefined<T>(key: MetaKey, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined
}

/** Get metadata from a method with no default (returns undefined if absent) */
export function getMethodMetaOrUndefined<T>(
  key: MetaKey,
  target: object,
  method: string,
): T | undefined {
  return Reflect.getMetadata(key, target, method) as T | undefined
}

// ── Accumulate: Arrays ──────────────────────────────────────────

/** Append items to an array stored in class metadata */
export function pushClassMeta<T>(key: MetaKey, target: object, ...items: T[]): void {
  const existing: T[] = Reflect.getMetadata(key, target) ?? []
  Reflect.defineMetadata(key, [...existing, ...items], target)
}

/** Append items to an array stored in method metadata */
export function pushMethodMeta<T>(
  key: MetaKey,
  target: object,
  method: string,
  ...items: T[]
): void {
  const existing: T[] = Reflect.getMetadata(key, target, method) ?? []
  Reflect.defineMetadata(key, [...existing, ...items], target, method)
}

// ── Accumulate: Maps ────────────────────────────────────────────

/** Set a key/value in a Map stored in class metadata */
export function setInMetaMap<K, V>(key: MetaKey, target: object, mapKey: K, mapValue: V): void {
  const existing: Map<K, V> = Reflect.getMetadata(key, target) ?? new Map()
  existing.set(mapKey, mapValue)
  Reflect.defineMetadata(key, existing, target)
}

/** Get a Map from class metadata (returns empty Map if absent) */
export function getMetaMap<K, V>(key: MetaKey, target: object): Map<K, V> {
  return Reflect.getMetadata(key, target) ?? new Map()
}

// ── Accumulate: Records ─────────────────────────────────────────

/** Set a key/value in a Record stored in class metadata */
export function setInMetaRecord<V>(
  key: MetaKey,
  target: object,
  recKey: string | number,
  recValue: V,
): void {
  const existing: Record<string | number, V> = Reflect.getMetadata(key, target) ?? {}
  existing[recKey] = recValue
  Reflect.defineMetadata(key, existing, target)
}

/** Get a Record from class metadata (returns empty object if absent) */
export function getMetaRecord<V>(key: MetaKey, target: object): Record<string | number, V> {
  return Reflect.getMetadata(key, target) ?? {}
}
