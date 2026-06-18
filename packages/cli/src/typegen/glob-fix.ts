/**
 * Module-glob convenience for the orphaned-class case.
 *
 * A decorated class (`@Controller`, `@Service`, …) only registers at runtime
 * if some module's `import.meta.glob([...], { eager: true })` imports its file —
 * that eager import is what fires the decorator. When an adopter organises a
 * module into sub-directories (`controllers/`, `presentation/`, …) the
 * scaffolded glob often doesn't reach the new depth, so those classes never
 * load: routes silently vanish, DI tokens resolve `undefined`.
 *
 * The scanner already detects this (`orphanedClasses`). These helpers turn the
 * detection into a fix:
 *
 *   - {@link suggestGlobsForOrphans} derives the minimal set of RECURSIVE glob
 *     patterns (`./**\/*.controller.ts`) that would cover the orphans — depth
 *     independent, so it keeps working however the adopter nests files.
 *   - {@link patchModuleGlobSource} splices those patterns into the module
 *     file's existing `import.meta.glob(...)` call (array or bare-string form),
 *     skipping any already present. Drives `kick typegen --fix`.
 */

import { extractGlobPatterns } from './scanner'

/** One orphan, reduced to what the fixer needs. */
export interface OrphanLike {
  /** Project-relative path of the orphaned class file, e.g. `src/modules/x/controllers/x.controller.ts`. */
  relativePath: string
}

/** Strip the trailing extension, returning `{ stem, ext }` (ext WITHOUT the dot). */
function splitExt(basename: string): { stem: string; ext: string } {
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return { stem: basename, ext: '' }
  return { stem: basename.slice(0, dot), ext: basename.slice(dot + 1) }
}

/**
 * Derive the recursive glob that would cover a single orphan file.
 *
 * `expenses.controller.ts` → `./**\/*.controller.ts` (precise: only sibling
 * controllers, at any depth). A file with no compound suffix (`thing.ts`) falls
 * back to `./**\/*.ts` for that extension — broader, but still scoped to the
 * module's own tree.
 */
export function globForOrphanFile(relativePath: string): string {
  const normalised = relativePath.replaceAll('\\', '/')
  const basename = normalised.slice(normalised.lastIndexOf('/') + 1)
  const { stem, ext } = splitExt(basename)
  const extPart = ext || 'ts'
  // `expenses.controller` → kind = `controller`; `expenses` → no kind.
  const innerDot = stem.lastIndexOf('.')
  if (innerDot > 0) {
    return `./**/*.${stem.slice(innerDot + 1)}.${extPart}`
  }
  return `./**/*.${extPart}`
}

/**
 * The distinct, sorted set of recursive globs covering a module's orphans.
 * Feed the orphans of ONE module file (group by `moduleFilePath` first).
 */
export function suggestGlobsForOrphans(orphans: readonly OrphanLike[]): string[] {
  const set = new Set<string>()
  for (const o of orphans) set.add(globForOrphanFile(o.relativePath))
  return [...set].toSorted()
}

/**
 * Splice `addPatterns` into the FIRST `import.meta.glob(...)` call in `source`,
 * preserving the existing patterns. Handles both the array form
 * (`import.meta.glob(['./a'], …)`) and the bare-string form
 * (`import.meta.glob('./a', …)`, which is upgraded to an array).
 *
 * Patterns already present (positive or negated) are skipped, so it's
 * idempotent. Returns the patched source, or `null` when there's no glob call
 * to patch or nothing new to add.
 */
export function patchModuleGlobSource(
  source: string,
  addPatterns: readonly string[],
): string | null {
  const callIdx = source.search(/\bimport\.meta\.glob\s*\(/)
  if (callIdx < 0) return null

  const open = source.indexOf('(', callIdx)
  if (open < 0) return null

  // Skip patterns the call already declares (compare on the bare body so a
  // negation like `!./**/*.test.ts` doesn't re-add `./**/*.test.ts`).
  const existing = new Set(
    extractGlobPatterns(source).map((p) => (p.startsWith('!') ? p.slice(1) : p)),
  )
  const fresh = addPatterns.filter((p) => !existing.has(p))
  if (fresh.length === 0) return null

  const insertion = fresh.map((p) => `'${p}'`).join(', ')

  // Array form: insert before the closing `]` of the first array literal.
  const bracket = source.indexOf('[', open)
  const closeParen = source.indexOf(')', open)
  if (bracket >= 0 && (closeParen < 0 || bracket < closeParen)) {
    const closeBracket = source.indexOf(']', bracket)
    if (closeBracket < 0) return null
    // Respect a trailing comma / whitespace already before `]`.
    const before = source.slice(0, closeBracket)
    const needsComma = !/[[,]\s*$/.test(before)
    const sep = needsComma ? ', ' : ''
    return before + sep + insertion + source.slice(closeBracket)
  }

  // Bare-string form: wrap the first string literal into an array.
  const strRe = /(['"`])((?:\\.|(?!\1).)*)\1/
  const tail = source.slice(open + 1)
  const m = strRe.exec(tail)
  if (!m) return null
  const absStart = open + 1 + m.index
  const absEnd = absStart + m[0].length
  return source.slice(0, absStart) + `[${m[0]}, ${insertion}]` + source.slice(absEnd)
}
