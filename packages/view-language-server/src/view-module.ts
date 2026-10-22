/**
 * Which `@forinda/kickjs-view` the server runs: the project's own, so the
 * editor parses, checks and formats exactly as the app's build does, or the
 * copy bundled with the server when the project has none (or one too old to
 * have what the editor calls).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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

/** The `version` in the package.json above the resolved entry. */
function versionAbove(file: string): string {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg.name === '@forinda/kickjs-view') return pkg.version
    } catch {}
  }
  return 'unknown'
}

export async function loadViewModule(
  root: string,
  warn: (message: string) => void,
): Promise<{ view: ViewModule; source: 'project' | 'bundled'; version: string }> {
  let reason = 'the project has no @forinda/kickjs-view'
  try {
    const entry = createRequire(join(root, 'package.json')).resolve('@forinda/kickjs-view')
    reason = `the project's @forinda/kickjs-view ${versionAbove(entry)}`
    const mod = await import(pathToFileURL(entry).href)
    const missing = REQUIRED.filter((k) => !(k in mod))
    if (!missing.length)
      return { view: mod as ViewModule, source: 'project', version: versionAbove(entry) }
    reason += ` lacks ${missing.join(', ')}`
  } catch (err) {
    if ((err as { code?: string }).code !== 'MODULE_NOT_FOUND')
      reason += ` failed to load: ${(err as Error).message}`
  }
  if (!warned) {
    warned = true
    warn(`kick views: ${reason} — using the bundled ${BUNDLED_VERSION}`)
  }
  return { view: bundled, source: 'bundled', version: BUNDLED_VERSION }
}
