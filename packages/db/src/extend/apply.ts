// Runtime for `$extends({ model, result })`.
//
// Two extension surfaces, applied in order:
//
//   1. **result extensions** rebuild the client around a Kysely
//      instance with the ResultExtensionPlugin appended. We can't
//      mutate plugins on a live Kysely (it freezes the plugin chain
//      at construction), but `qb.withPlugin(plugin)` returns a fresh
//      Kysely with the plugin added — that's what we wrap. The new
//      client shares the same InternalContext as the parent (events
//      emitter identity stays stable across extensions, transactions
//      keep working), but routes queries through the plugin.
//
//   2. **model extensions** layer a Proxy over whatever client the
//      previous step produced. The Proxy's `get` returns the per-
//      table method bag for keys that match a model entry; methods
//      are pre-bound via Function.prototype.call so `this` inside
//      the method is the extended proxy. That way chaining
//      `this.<otherTable>.<method>` or `this.transaction(...)`
//      resolves naturally regardless of which extension order ran.
//
// Lazy proxy reference: the bound methods need to capture `proxy`
// itself, but the proxy can't exist until its handler is built.
// Closure over a mutable `proxy` reference solves the cycle — by the
// time any method actually runs, the binding has landed.

import type { KickDbClient } from '../client/types'
import type { ExtendedClient, ExtensionDefinition, ResultExtensions } from './types'
import { ResultExtensionPlugin } from './result-plugin'
import { wrap, type InternalContext } from '../client/wrap'

export function applyExtensions<DB, E extends ExtensionDefinition<DB>>(
  client: KickDbClient<DB>,
  ctx: InternalContext,
  ext: E,
): ExtendedClient<DB, E> {
  // 1. Result extensions — rebuild Kysely around the plugin chain.
  //    `wrap` and this module form an ESM cycle (wrap calls
  //    applyExtensions for the client's `$extends`; we call wrap to
  //    rebuild the client). ESM live bindings handle this fine as
  //    long as nothing reads the binding at module top-level — both
  //    sides only call into each other inside functions.
  let baseClient: KickDbClient<DB> = client
  if (hasResultExtensions(ext.result)) {
    const plugin = new ResultExtensionPlugin(ext.result as ResultExtensions<unknown>)
    const newQb = client.qb.withPlugin(plugin)
    baseClient = wrap<DB>(newQb, ctx)
  }

  // 2. Model proxy — layered on top of whichever base client we got
  //    so model methods see the result-augmented row types via `this`.
  let proxy: ExtendedClient<DB, E>

  const modelBag: Record<string, Record<string, (...args: unknown[]) => unknown>> = {}
  const model = ext.model ?? {}
  for (const tableName of Object.keys(model) as (keyof typeof model)[]) {
    const methods = model[tableName]
    if (!methods) continue
    const bound: Record<string, (...args: unknown[]) => unknown> = {}
    for (const [methodName, fn] of Object.entries(methods)) {
      bound[methodName] = (...args) => (fn as (...a: unknown[]) => unknown).call(proxy, ...args)
    }
    modelBag[tableName as string] = bound
  }

  proxy = new Proxy(baseClient, {
    get(target, prop) {
      // Own-property check — `prop in modelBag` would also match
      // inherited keys like `toString` / `hasOwnProperty` from
      // Object.prototype, intercepting properties we never asked to
      // own and breaking the underlying client's own equivalents.
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(modelBag, prop)) {
        return modelBag[prop]
      }
      // Fall through. Bound methods on the underlying KickDbClient
      // (selectFrom, transaction, etc.) keep their original `this`
      // since `wrap()` already bound them to kysely at create time.
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return value
    },
  }) as ExtendedClient<DB, E>

  return proxy
}

function hasResultExtensions(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  for (const bag of Object.values(result as Record<string, unknown>)) {
    if (bag && typeof bag === 'object' && Object.keys(bag as object).length > 0) return true
  }
  return false
}
