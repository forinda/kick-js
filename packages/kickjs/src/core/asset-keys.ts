// Shared asset-key strategy — used by the build pipeline, the
// runtime dev resolver, and the typegen emitter so all three layers
// agree on what the manifest looks like.
//
// Three strategies:
//
//   - `'strip'` — drop the final extension. `pages/index.pug` →
//     `pages/index`. Best for namespaces where every basename is
//     unique (mail templates, pdf invoices). Shortest autocomplete.
//
//   - `'with-extension'` — keep the extension. `pages/index.pug` →
//     `pages/index.pug`. Required when extension siblings coexist.
//
//   - `'auto'` (default) — strip when safe, keep extensions when not.
//     The grouping pass collects files by stripped basename; groups
//     of one keep the stripped key, groups of more than one keep the
//     full path. Backward compatible for projects with no
//     extension-siblings; lossless for projects that have them.
//
// The function returns the path / key pairs in walk order (input
// order preserved) so callers can iterate without re-sorting. Sort
// in the caller if a stable manifest order is needed.

export type AssetKeyStrategy = 'auto' | 'strip' | 'with-extension'

export interface AssetKeyPair {
  /** Source-relative path the file was discovered at. */
  rel: string
  /** Final logical key for the manifest, including the namespace prefix. */
  key: string
}

export interface GroupAssetKeysOptions {
  /**
   * Strategy applied to this namespace. Default `'auto'`.
   *
   * Adopters override per-namespace via `assetMap.<ns>.keys` in
   * kick.config.ts when they want uniform behaviour (e.g. always
   * include the extension regardless of collisions).
   */
  strategy?: AssetKeyStrategy
}

export interface GroupAssetKeysResult {
  pairs: AssetKeyPair[]
  /**
   * Number of collision groups resolved by keeping extensions.
   * Surfaces as an informational log ("auto-resolved N collisions")
   * so adopters know whether they're relying on auto-mode or not.
   * Always 0 for `'strip'` (overwrites) and `'with-extension'`
   * (extensions always preserved, no collision possible).
   */
  collisionGroupsResolved: number
}

/**
 * Compute final manifest keys for a namespace's discovered paths,
 * given the chosen strategy. Pure function — no fs / config / globals
 * involved.
 *
 * @param namespace assetMap key — e.g. `'mails'`, `'pages'`.
 * @param paths source-relative file paths (POSIX separators) discovered
 *              under the namespace's `src` directory.
 * @param opts grouping options.
 */
export function groupAssetKeys(
  namespace: string,
  paths: readonly string[],
  opts: GroupAssetKeysOptions = {},
): GroupAssetKeysResult {
  const strategy = opts.strategy ?? 'auto'

  if (strategy === 'with-extension') {
    return {
      pairs: paths.map((rel) => ({ rel, key: `${namespace}/${rel}` })),
      collisionGroupsResolved: 0,
    }
  }

  if (strategy === 'strip') {
    // Strict strip — last-walk-order wins on collision; no
    // collision tracking here because the docs document this as the
    // adopter's choice. The caller (build / runtime / typegen) can
    // still warn if it wants; this function just shapes keys.
    return {
      pairs: paths.map((rel) => ({ rel, key: `${namespace}/${stripExt(rel)}` })),
      collisionGroupsResolved: 0,
    }
  }

  // strategy === 'auto' — group by stripped basename, keep
  // extensions only on collision groups.
  const groups = new Map<string, string[]>()
  for (const rel of paths) {
    const strippedKey = `${namespace}/${stripExt(rel)}`
    const arr = groups.get(strippedKey)
    if (arr) {
      arr.push(rel)
    } else {
      groups.set(strippedKey, [rel])
    }
  }

  let collisionGroupsResolved = 0
  // Build a per-rel decision table so we preserve input ordering in
  // the output (manifest writers rely on stable ordering).
  const keyByRel = new Map<string, string>()
  for (const [strippedKey, rels] of groups) {
    if (rels.length === 1) {
      keyByRel.set(rels[0], strippedKey)
    } else {
      collisionGroupsResolved += 1
      for (const rel of rels) {
        keyByRel.set(rel, `${namespace}/${rel}`)
      }
    }
  }

  return {
    pairs: paths.map((rel) => ({
      rel,
      key: keyByRel.get(rel) ?? `${namespace}/${rel}`,
    })),
    collisionGroupsResolved,
  }
}

/** Strip the final extension from a path. `'mails/welcome.ejs'` → `'mails/welcome'`. */
export function stripExt(path: string): string {
  // Inline the logic instead of importing extname so this module
  // stays usable in pure-browser contexts. Same algorithm: find the
  // last dot AFTER the last separator, slice up to it.
  const lastSlash = path.lastIndexOf('/')
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) return path // no ext, or hidden file like `.env`
  const dirPart = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : ''
  return dirPart + filename.slice(0, lastDot)
}
