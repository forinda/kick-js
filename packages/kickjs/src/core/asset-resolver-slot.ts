/**
 * Indirection slot between the DI container's `@Asset` property injection
 * and the asset manager. The container must NOT import `./assets` directly —
 * its eager `node:fs`/`node:path` imports would poison the edge-safe
 * `@forinda/kickjs/web` entry graph (every graph includes the container).
 *
 * `./assets` registers the real resolver at module scope, so any node app
 * that imports the asset manager (the core barrel does) gets full `@Asset`
 * behavior; an edge bundle that never imports it gets a clear error on
 * first `@Asset` property access instead of a broken bundle.
 */

type AssetResolver = (namespace: string, key: string) => unknown

let impl: AssetResolver | null = null

/** Called by `./assets` at module scope to install the real resolver. */
export function _setAssetResolver(fn: AssetResolver): void {
  impl = fn
}

/** Resolve an asset through the slot — throws when no asset manager is loaded. */
export function resolveAssetViaSlot(namespace: string, key: string): unknown {
  if (!impl) {
    throw new Error(
      `@Asset('${namespace}/${key}'): the asset manager is not loaded. ` +
        "Import it (any import from '@forinda/kickjs' loads it) — note @Asset " +
        'reads from the filesystem and is not supported on edge runtimes.',
    )
  }
  return impl(namespace, key)
}
