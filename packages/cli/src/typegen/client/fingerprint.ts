/**
 * Staleness check for the client route map.
 *
 * Resolving the map means building a TypeScript program over the server and
 * type-checking every route. Measured on a 1,940-route app: 6.6s and 1.1 GB,
 * of which `createProgram` alone is 2.7s / 650 MB. That cost is inherent — you
 * cannot resolve a type without the graph it lives in — so the only way to
 * avoid paying it is to notice that nothing changed.
 *
 * Reading and hashing every project file costs **35ms** on that same app. Two
 * orders of magnitude cheaper than the work it can skip, which is what makes
 * this worth doing at all.
 *
 * @module @forinda/kickjs-cli/typegen/client/fingerprint
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Lockfiles, so a dependency upgrade invalidates the map like a source edit. */
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb']

/**
 * Paths that must not be hashed.
 *
 * `node_modules` for cost — it is the bulk of the program, and the lockfile
 * stands in for it. `.kickjs` because that is where typegen's own output
 * lives, including this map: the scaffolded `tsconfig.json` includes
 * `.kickjs/types/**\/*.d.ts`, so hashing it would make the fingerprint depend
 * on the previous run's output and never match twice.
 */
const IGNORED = /(?:^|[\\/])(?:node_modules|\.kickjs)(?:[\\/]|$)/

export interface FingerprintInput {
  projectDir: string
  /** Project files in the program — `node_modules` excluded, see below. */
  fileNames: readonly string[]
  /**
   * The route keys the map is built for.
   *
   * These come from the scanner, not from `tsconfig`, and the scan root is
   * configurable — so a route can move without any hashed file moving. Hashing
   * the derived keys covers that directly, whatever the scan was pointed at.
   */
  keys: readonly string[]
  /** Compiler options, since they change how types resolve. */
  options: unknown
  /** CLI version — a generator change must invalidate a cached map. */
  cliVersion: string
}

/**
 * A hash of everything the emitted map depends on.
 *
 * `node_modules` is deliberately not hashed: it is the bulk of the program
 * (4,207 files against 2,851 project files on the reference app) and hashing
 * it would cost more than it saves. Dependency changes are caught through the
 * lockfile instead, which moves whenever an installed version does.
 */
/** SHA-1 of an arbitrary string — used to record expected output bytes. */
export function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

export function fingerprint(input: FingerprintInput): string {
  const h = createHash('sha1')
  h.update(input.cliVersion)
  h.update(JSON.stringify(input.options ?? {}))
  h.update(input.keys.join('\n'))

  for (const lock of LOCKFILES) {
    const p = join(input.projectDir, lock)
    if (existsSync(p)) {
      try {
        h.update(readFileSync(p))
      } catch (err) {
        // A marker here would be a *stable* hash input: a lockfile that stays
        // unreadable would keep hashing the same, so later dependency changes
        // would match the stamp and skip. Throwing means no fingerprint, which
        // means the pass runs.
        throw new Error(`kick/client: cannot read lockfile ${p}`, { cause: err })
      }
    }
  }

  // Sorted, so directory-iteration order cannot change the hash.
  for (const f of input.fileNames.toSorted()) {
    // Both separators: TypeScript normalises to `/`, but a path handed in
    // from elsewhere on Windows may not be.
    if (IGNORED.test(f)) continue
    h.update(f)
    try {
      h.update(readFileSync(f))
    } catch (err) {
      // Same reasoning as the lockfile above: no fingerprint beats a
      // fingerprint that cannot tell two states apart.
      throw new Error(`kick/client: cannot read project file ${f}`, { cause: err })
    }
  }
  return h.digest('hex')
}
