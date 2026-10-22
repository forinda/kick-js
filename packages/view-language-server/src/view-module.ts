/**
 * Which `@forinda/kickjs-view` the server runs: the project's own, so the
 * editor parses, checks and formats exactly as the app's build does, or the
 * copy bundled with the server when the project has none (or one too old to
 * have what the editor calls).
 */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as bundled from '@forinda/kickjs-view'
import type { ViewModule } from './workspace'

declare const __KICK_VIEW_VERSION__: string | undefined
const BUNDLED_VERSION =
  typeof __KICK_VIEW_VERSION__ === 'string' ? __KICK_VIEW_VERSION__ : 'unknown'

const REQUIRED = [
  'parse',
  'check',
  'format',
  'readPipeExports',
  'templateName',
  'componentTag',
  'BUILTIN_PIPES',
]

let warned = false

/**
 * The project's `@forinda/kickjs-view` entry and version. Its exports map
 * only has `import`, which `require.resolve` can't see — so find the
 * package folder and read the entry from its exports.
 */
function findProjectView(root: string): { entry: string; version: string } | undefined {
  // node_modules at and above the root only — not NODE_PATH or global folders.
  for (let dir = root; ; dir = dirname(dir)) {
    const pkgDir = join(dir, 'node_modules/@forinda/kickjs-view')
    let pkg
    try {
      pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    } catch {
      if (dir === dirname(dir)) return undefined
      continue
    }
    const dot = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.']
    const rel =
      typeof dot === 'string' ? dot : (dot?.node ?? dot?.import ?? dot?.default ?? pkg.main)
    const entry = resolve(pkgDir, typeof rel === 'string' ? rel : 'index.js')
    // An exports map pointing outside the package isn't followed.
    if (relative(pkgDir, entry).startsWith('..') || isAbsolute(relative(pkgDir, entry)))
      return undefined
    return { entry, version: pkg.version }
  }
}

export async function loadViewModule(
  root: string,
  warn: (message: string) => void,
  /** The editor trusts this workspace: only then is the project's code imported. */
  trusted: boolean,
): Promise<{ view: ViewModule; source: 'project' | 'bundled'; version: string }> {
  if (!trusted) return { view: bundled, source: 'bundled', version: BUNDLED_VERSION }
  const found = findProjectView(root)
  let reason = 'the project has no @forinda/kickjs-view'
  if (found) {
    reason = `the project's @forinda/kickjs-view ${found.version}`
    try {
      const mod = await import(pathToFileURL(found.entry).href)
      const missing = REQUIRED.filter((k) => !(k in mod))
      if (!missing.length)
        return { view: mod as ViewModule, source: 'project', version: found.version }
      reason += ` lacks ${missing.join(', ')}`
    } catch (err) {
      reason += ` failed to load: ${(err as Error).message}`
    }
  }
  if (!warned) {
    warned = true
    warn(`kick views: ${reason} — using the bundled ${BUNDLED_VERSION}`)
  }
  return { view: bundled, source: 'bundled', version: BUNDLED_VERSION }
}
