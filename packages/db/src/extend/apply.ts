// Runtime for `$extends({ model })`.
//
// Builds a Proxy over the original client whose `get` returns the
// per-table method bag for keys that match a model entry, falling
// through to the underlying client for everything else. Methods are
// pre-bound (via Function.prototype.call) so `this` inside the
// method points back at the proxy — chaining `this.<otherTable>.<m>`
// or `this.transaction(...)` resolves naturally.
//
// Lazy proxy reference: the bound methods need to capture `proxy`
// itself, but the proxy can't exist until its handler is built.
// Closure over a mutable `proxy` reference solves the cycle — by
// the time any method actually runs, the binding has landed.

import type { KickDbClient } from '../client/types'
import type { ExtendedClient, ExtensionDefinition } from './types'

export function applyExtensions<DB, E extends ExtensionDefinition<DB>>(
  client: KickDbClient<DB>,
  ext: E,
): ExtendedClient<DB, E> {
  // proxy holds the eventual reference; methods capture it by
  // closure so they receive the extended client as `this`.
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

  proxy = new Proxy(client, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in modelBag) return modelBag[prop]
      // Fall through. Bound methods on the underlying KickDbClient
      // (selectFrom, transaction, etc.) keep their original `this`
      // since `wrap()` already bound them to kysely at create time.
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return value
    },
  }) as ExtendedClient<DB, E>

  return proxy
}
