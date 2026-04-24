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
 * Toggle prettier post-write formatting. Defaults to enabled — generators
 * always emit formatted output unless the caller opts out (rare; useful
 * for tests that want byte-stable assertions against raw template strings).
 */
export function setFormatOnWrite(enabled: boolean): void {
  _format = enabled
}

/** Extensions prettier can format. Anything else is written verbatim. */
const FORMATTABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md'])

/**
 * Write a file, creating parent directories if needed.
 *
 * After write, runs prettier against the file when:
 *   - format-on-write is enabled (default)
 *   - the extension is in {@link FORMATTABLE}
 *   - prettier resolves from the user's project (or our own cwd)
 *
 * Failures (missing prettier, unparseable source, prettier crash) are
 * swallowed silently — formatting is a polish step, not a correctness
 * gate. The pre-existing pre-commit hook still catches anything we
 * couldn't format.
 *
 * Skips writing entirely in dry run mode.
 */
export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  if (_dryRun) return
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
  if (_format && FORMATTABLE.has(extname(filePath))) {
    await formatFile(filePath, content).catch(() => {
      // Prettier missing or unparseable source — leave the unformatted
      // file in place. Pre-commit hook will catch shipping-blocker
      // formatting issues.
    })
  }
}

let _prettier: PrettierModule | null | undefined = undefined

interface PrettierModule {
  format(source: string, opts: Record<string, unknown>): Promise<string> | string
  resolveConfig(file: string): Promise<Record<string, unknown> | null>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getFileInfo(
    file: string,
    opts?: Record<string, unknown>,
  ): Promise<{ inferredParser: string | null; ignored?: boolean }> | any
}

/** Resolve prettier from the user's project; cache the result (or null) for the process. */
function resolvePrettier(cwd: string): PrettierModule | null {
  if (_prettier !== undefined) return _prettier
  try {
    const req = createRequire(join(cwd, 'package.json'))
    _prettier = req('prettier') as PrettierModule
  } catch {
    _prettier = null
  }
  return _prettier
}

async function formatFile(filePath: string, content: string): Promise<void> {
  const prettier = resolvePrettier(process.cwd())
  if (!prettier) return
  // Honour the project's .prettierrc / .prettierignore. Resolving with
  // the file path picks the right config block in monorepos with nested
  // overrides.
  const info = await prettier.getFileInfo(filePath, { resolveConfig: true })
  if (info.ignored) return
  const config = (await prettier.resolveConfig(filePath)) ?? {}
  const formatted = await prettier.format(content, {
    ...config,
    filepath: filePath,
  })
  if (formatted === content) return
  await writeFile(filePath, formatted, 'utf-8')
}

/** Reset cached prettier resolution. Tests use this; production code shouldn't. */
export function clearFormatCache(): void {
  _prettier = undefined
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
