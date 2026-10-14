/**
 * Conditions that switch an adapter on or off at startup, with the reason
 * recorded — so "why isn't Redis connected?" has an answer in the boot report
 * rather than in the adapter's code.
 *
 * @module @forinda/kickjs/core/adapter-conditions
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * `true` keeps the adapter; `false` or a string (the reason) leaves it out.
 * Runs once at startup — keep it synchronous and free of side effects.
 */
export type AdapterCondition = () => boolean | string

/** One adapter's outcome, as `app.getConditionReport()` lists it. */
export interface ConditionOutcome {
  adapter: string
  enabled: boolean
  /** Why it was left out; absent when enabled. */
  reason?: string
}

/**
 * On when the env variable is set (non-empty) — or equals `value`.
 *
 *   when: onEnv('REDIS_URL')
 *   when: onEnv('QUEUE_DRIVER', 'redis')
 */
export function onEnv(name: string, value?: string): AdapterCondition {
  return () => {
    const actual = process.env[name]
    if (value === undefined) return actual ? true : `${name} is not set`
    return actual === value
      ? true
      : `${name} is ${actual === undefined ? 'not set' : `'${actual}'`}, not '${value}'`
  }
}

/**
 * On when the app can import `name` — for an adapter that needs an optional
 * dependency.
 *
 *   when: onPackage('ioredis')
 */
export function onPackage(name: string): AdapterCondition {
  return () => {
    try {
      createRequire(join(process.cwd(), 'package.json')).resolve(name)
      return true
    } catch {
      return `package '${name}' is not installed`
    }
  }
}

/** On only when every condition is — the first that fails gives the reason. */
export function allOf(...conditions: AdapterCondition[]): AdapterCondition {
  return () => {
    for (const condition of conditions) {
      const result = condition()
      if (result !== true) return result
    }
    return true
  }
}

/** `true`, or the reason it is off. A throwing condition is off, with its error. */
export function evaluateCondition(condition: AdapterCondition): true | string {
  try {
    const result = condition()
    if (result === true) return true
    return typeof result === 'string' && result.length > 0 ? result : 'its condition returned false'
  } catch (err) {
    return `its condition threw: ${err instanceof Error ? err.message : String(err)}`
  }
}
