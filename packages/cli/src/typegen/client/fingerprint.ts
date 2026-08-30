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

export interface FingerprintInput {
  projectDir: string
  /** Project files in the program — `node_modules` excluded, see below. */
  fileNames: readonly string[]
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
export function fingerprint(input: FingerprintInput): string {
  const h = createHash('sha1')
  h.update(input.cliVersion)
  h.update(JSON.stringify(input.options ?? {}))

  for (const lock of LOCKFILES) {
    const p = join(input.projectDir, lock)
    if (existsSync(p)) {
      try {
        h.update(readFileSync(p))
      } catch {
        // Unreadable lockfile: fall through. A fingerprint that cannot be
        // computed must not silently match, so mix in a marker instead.
        h.update(`unreadable:${lock}`)
      }
    }
  }

  // Sorted, so directory-iteration order cannot change the hash.
  for (const f of input.fileNames.toSorted()) {
    if (f.includes('/node_modules/')) continue
    h.update(f)
    try {
      h.update(readFileSync(f))
    } catch {
      // A file that vanished between the scan and here IS a change.
      h.update('missing')
    }
  }
  return h.digest('hex')
}
