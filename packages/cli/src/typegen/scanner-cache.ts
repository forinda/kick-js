/**
 * Persistent per-file extraction cache for the typegen scanner.
 *
 * The scanner's dominant cost on large projects is reading every
 * `src/**\/*.ts` file and running the regex extractors over each one.
 * On a watch/rebuild loop almost nothing has changed, yet the old
 * `scanProject` re-read and re-scanned the entire tree every time.
 *
 * This cache stores the per-file extraction result (`FileExtract`)
 * keyed by a cheap filesystem signature (`mtimeMs:size`). On the next
 * scan we `stat()` each file — a near-free syscall, no content read —
 * and reuse the cached extract whenever the signature is unchanged.
 * Only genuinely-changed files pay the readFile + regex cost.
 *
 * We deliberately key on `mtimeMs:size` rather than a content hash:
 * hashing requires reading the file, which is exactly the cost we are
 * trying to avoid. The cross-file join phase in `scanProject` always
 * re-runs over the full (cached + fresh) extract set, so a stale entry
 * can never produce an inconsistent `ScanResult` — the worst case of a
 * signature collision (same size, identical mtime, different content)
 * is a missed re-scan, which `--no-cache` / a `clean` sidesteps.
 *
 * @module @forinda/kickjs-cli/typegen/scanner-cache
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FileExtract } from './scanner'

/** Bump when the shape of `FileExtract` (or any extractor) changes. */
const CACHE_VERSION = 1

/** The array-valued keys every `FileExtract` must carry. */
const EXTRACT_ARRAY_KEYS = [
  'classes',
  'tokens',
  'injects',
  'pluginsAndAdapters',
  'augmentations',
  'contextKeys',
  'routes',
  'moduleMounts',
  'globPatterns',
] as const

/**
 * Structurally validate a cached extract before trusting it. The join
 * phase spreads these arrays (`...extract.classes`), so a truncated or
 * hand-edited `scan.json` whose entry is missing a field would crash
 * the scanner. Rejecting the entry here lets the cache self-heal — the
 * file is treated as uncached and re-scanned.
 */
function isFileExtract(value: unknown): value is FileExtract {
  if (!value || typeof value !== 'object') return false
  const extract = value as Record<string, unknown>
  return EXTRACT_ARRAY_KEYS.every((key) => Array.isArray(extract[key]))
}

/** One cached file: its signature plus the extraction it produced. */
interface CacheEntry {
  /** `${mtimeMs}:${size}` — cheap change signature, no content read. */
  sig: string
  extract: FileExtract
}

/** On-disk cache document. */
interface CacheDoc {
  version: number
  /** Keyed by absolute file path. */
  files: Record<string, CacheEntry>
}

/**
 * In-memory + on-disk cache handle. Construct via `loadScanCache`,
 * consult with `get`, populate with `set`, and persist via `save`.
 * Entries for files no longer present on disk are dropped on `save`
 * (the scanner reports every live path through `markSeen`).
 */
export class ScanCache {
  private readonly path: string
  private readonly prev: Map<string, CacheEntry>
  private readonly next = new Map<string, FileExtract>()
  private readonly nextSig = new Map<string, string>()

  private constructor(path: string, prev: Map<string, CacheEntry>) {
    this.path = path
    this.prev = prev
  }

  /**
   * Load the cache for a given cache directory. A missing, unreadable,
   * malformed, or version-mismatched cache yields an empty cache — the
   * scan then behaves exactly like a cold first run.
   */
  static async load(cacheDir: string): Promise<ScanCache> {
    const file = join(cacheDir, 'scan.json')
    const prev = new Map<string, CacheEntry>()
    try {
      const raw = await readFile(file, 'utf-8')
      const doc = JSON.parse(raw) as CacheDoc
      if (doc.version === CACHE_VERSION && doc.files) {
        for (const [path, entry] of Object.entries(doc.files)) {
          if (entry && typeof entry.sig === 'string' && isFileExtract(entry.extract)) {
            prev.set(path, entry)
          }
        }
      }
    } catch {
      // Cold start — empty cache.
    }
    return new ScanCache(file, prev)
  }

  /** Compute the `mtimeMs:size` signature for a file, or null if stat fails. */
  static async signature(filePath: string): Promise<string | null> {
    try {
      const s = await stat(filePath)
      return `${s.mtimeMs}:${s.size}`
    } catch {
      return null
    }
  }

  /**
   * Return the cached extract for `filePath` iff its stored signature
   * matches `sig`. A hit means the file is byte-identical to last scan
   * (modulo an mtime+size collision) and need not be re-read.
   */
  get(filePath: string, sig: string): FileExtract | null {
    const entry = this.prev.get(filePath)
    return entry && entry.sig === sig ? entry.extract : null
  }

  /** Record a fresh (or reused) extract for the next `save`. */
  set(filePath: string, sig: string, extract: FileExtract): void {
    this.next.set(filePath, extract)
    this.nextSig.set(filePath, sig)
  }

  /** Every file path present in the loaded (previous) cache. */
  cachedFiles(): string[] {
    return [...this.prev.keys()]
  }

  /**
   * Read a previously-cached extract WITHOUT a signature check. Used by
   * the incremental scan, where Vite has already told us precisely which
   * files changed — so unchanged files are trusted as-is, skipping even
   * the `stat()` a full scan would do.
   */
  peek(filePath: string): FileExtract | null {
    return this.prev.get(filePath)?.extract ?? null
  }

  /**
   * Carry a previously-cached entry forward into the next `save`,
   * unchanged. Returns false if the file was not in the prior cache.
   */
  carry(filePath: string): boolean {
    const entry = this.prev.get(filePath)
    if (!entry) return false
    this.next.set(filePath, entry.extract)
    this.nextSig.set(filePath, entry.sig)
    return true
  }

  /**
   * Persist the cache. Only files passed through `set` this run survive,
   * so entries for deleted files are pruned automatically. Best-effort:
   * a write failure is swallowed (the cache is an optimization, never a
   * correctness dependency).
   */
  async save(): Promise<void> {
    const files: Record<string, CacheEntry> = {}
    for (const [path, extract] of this.next) {
      const sig = this.nextSig.get(path)
      if (sig) files[path] = { sig, extract }
    }
    const doc: CacheDoc = { version: CACHE_VERSION, files }
    try {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(this.path, JSON.stringify(doc), 'utf-8')
    } catch {
      // Best-effort.
    }
  }
}
