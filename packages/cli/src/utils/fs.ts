import { existsSync } from 'node:fs'
import { writeFile, mkdir, access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'

let _dryRun = false
let _format = true

/** Enable/disable dry run mode globally for all writeFileSafe calls */
export function setDryRun(enabled: boolean): void {
  _dryRun = enabled
}

/**
 * Toggle oxfmt post-write formatting. Defaults to enabled — generators
 * always emit formatted output unless the caller opts out (rare; useful
 * for tests that want byte-stable assertions against raw template strings).
 */
export function setFormatOnWrite(enabled: boolean): void {
  _format = enabled
}

/** Extensions oxfmt can format. Anything else is written verbatim. */
const FORMATTABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md'])

/**
 * Write a file, creating parent directories if needed.
 *
 * After write, runs oxfmt against the file when:
 *   - format-on-write is enabled (default)
 *   - the extension is in {@link FORMATTABLE}
 *   - oxfmt resolves from the user's project (or our own cwd)
 *
 * Failures (missing oxfmt, unparseable source, formatter crash) are
 * swallowed silently — formatting is a polish step, not a correctness
 * gate. The pre-commit hook still catches anything we couldn't format.
 *
 * Skips writing entirely in dry run mode.
 */
export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  if (_dryRun) return
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
  if (_format && FORMATTABLE.has(extname(filePath))) {
    await formatFile(filePath, content).catch(() => {
      // Formatter missing or unparseable source — leave the unformatted
      // file in place. Pre-commit hook will catch shipping-blocker
      // formatting issues.
    })
  }
}

interface OxfmtFormatResult {
  code: string
  errors: unknown[]
}

interface OxfmtModule {
  format(
    fileName: string,
    sourceText: string,
    options?: Record<string, unknown>,
  ): Promise<OxfmtFormatResult>
}

let _oxfmt: OxfmtModule | null | undefined = undefined

/** Resolve oxfmt from the user's project; cache the result (or null) for the process. */
async function resolveOxfmt(cwd: string): Promise<OxfmtModule | null> {
  if (_oxfmt !== undefined) return _oxfmt
  try {
    const req = createRequire(join(cwd, 'package.json'))
    const oxfmtPath = req.resolve('oxfmt')
    _oxfmt = (await import(oxfmtPath)) as OxfmtModule
  } catch {
    _oxfmt = null
  }
  return _oxfmt
}

async function formatFile(filePath: string, content: string): Promise<void> {
  const oxfmt = await resolveOxfmt(process.cwd())
  if (!oxfmt) return
  // The CLI binary auto-discovers `.oxfmtrc.json`, but the JS API
  // does NOT — we walk up from the file being formatted so adopters'
  // workspace config drives the output. Skip formatting entirely
  // when no config is found (matches the old prettier failure mode:
  // raw templates already follow project conventions).
  const options = await loadOxfmtConfig(filePath)
  if (options === null) return
  const result = await oxfmt.format(filePath, content, options)
  if (result.code === content) return
  await writeFile(filePath, result.code, 'utf-8')
}

const _oxfmtConfigCache = new Map<string, Record<string, unknown> | null>()

/**
 * Walk up from `filePath`'s directory looking for `.oxfmtrc.json`.
 * Returns `null` when no config is found anywhere on the path —
 * generators then leave the raw template alone (which already
 * follows project conventions). Cached per starting directory so
 * the walk is one-shot per generator run.
 */
async function loadOxfmtConfig(filePath: string): Promise<Record<string, unknown> | null> {
  let dir = dirname(filePath)
  const startDir = dir
  if (_oxfmtConfigCache.has(startDir)) return _oxfmtConfigCache.get(startDir)!
  while (true) {
    const configPath = join(dir, '.oxfmtrc.json')
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, 'utf-8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        // The `$schema` and `ignorePatterns` fields are runner-only —
        // strip before passing to format() so it doesn't reject them
        // as unknown options.
        delete parsed['$schema']
        delete parsed.ignorePatterns
        _oxfmtConfigCache.set(startDir, parsed)
        return parsed
      } catch {
        _oxfmtConfigCache.set(startDir, null)
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      _oxfmtConfigCache.set(startDir, null)
      return null
    }
    dir = parent
  }
}

/** Reset cached oxfmt resolution. Tests use this; production code shouldn't. */
export function clearFormatCache(): void {
  _oxfmt = undefined
  _oxfmtConfigCache.clear()
}

/** Ensure a directory exists */
export async function ensureDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** Check if a file exists */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/** Read a JSON file */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonFile<T = any>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8')
  return JSON.parse(content)
}
