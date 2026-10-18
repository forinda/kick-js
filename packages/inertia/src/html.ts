/**
 * The HTML shell for a first visit, and the script tags that load the client:
 * Vite's dev server while `kick dev` runs, the build manifest in production.
 *
 * @module @forinda/kickjs-inertia/html
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from './inertia'

export interface HtmlParts {
  /** Script and style tags for the client entry. Put inside `<head>`. */
  head: string
  /** The page data and the mount element. Put inside `<body>`. */
  body: string
  page: Page
}

export type HtmlTemplate = (parts: HtmlParts) => string

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The default shell. Its `<title>` is a fallback: left out when the head
 * already has one (a server-rendered `<Head>`). In the browser, Inertia drops
 * it itself once a page's `<Head>` sets a title. `<html lang>` is the page's
 * `meta.lang`, else `'en'`.
 */
export const defaultTemplate =
  (title: string): HtmlTemplate =>
  ({ head, body, page }) =>
    `<!doctype html>
<html lang="${escapeHtml(page.meta?.lang ?? 'en')}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${/<title[\s>]/i.test(head) ? '' : `<title>${escapeHtml(title)}</title>`}
    ${head}
  </head>
  <body>
    ${body}
  </body>
</html>`

/**
 * The page as `<script data-page="app" type="application/json">` — where the
 * v3 client reads it — followed by the mount element. `<` and `/` are escaped
 * so a prop containing `</script>` cannot end the tag.
 */
export function pageBody(page: Page, id = 'app'): string {
  const json = JSON.stringify(page, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    .replace(/</g, '\\u003c')
    .replace(/\//g, '\\/')
  return `<script data-page="${id}" type="application/json">${json}</script>\n    <div id="${id}"></div>`
}

/** Dev: one module script; Vite's `transformIndexHtml` adds its client and plugin preambles. */
export function devHead(entry: string): string {
  return `<script type="module" src="/${entry.replace(/^\/+/, '')}"></script>`
}

interface ManifestChunk {
  file: string
  css?: string[]
  assets?: string[]
  imports?: string[]
}

function readManifest(clientDir: string): Record<string, ManifestChunk> {
  return JSON.parse(readFileSync(join(clientDir, '.vite', 'manifest.json'), 'utf8')) as Record<
    string,
    ManifestChunk
  >
}

/** Vite's default `[name]-[hash]`: an 8-character hash before the extension. */
const HASHED_NAME = /[.-][\w-]{8}\.\w+$/

/**
 * URL paths of the content-hashed files in the build manifest. A name without
 * a hash (an `entryFileNames` that leaves it out) is skipped: its content can
 * change under the same URL.
 */
export function hashedFiles(clientDir: string): Set<string> {
  const files = new Set<string>()
  for (const chunk of Object.values(readManifest(clientDir))) {
    for (const f of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      if (HASHED_NAME.test(f)) files.add(`/${f}`)
    }
  }
  return files
}

/** Production: the entry's script, its CSS, and the CSS and preloads of what it imports. */
export function manifestHead(clientDir: string, entry: string): string {
  const manifest = readManifest(clientDir)
  const chunk = manifest[entry]
  if (!chunk) {
    throw new Error(
      `InertiaAdapter: '${entry}' is not in ${clientDir}/.vite/manifest.json — build the client with build.manifest and this entry as an input.`,
    )
  }
  const css = new Set<string>()
  const preload = new Set<string>()
  const walk = (key: string, root: boolean) => {
    const c = manifest[key]
    if (!c) return
    for (const f of c.css ?? []) css.add(f)
    if (!root) preload.add(c.file)
    for (const i of c.imports ?? []) walk(i, false)
  }
  walk(entry, true)
  return [
    ...[...css].map((f) => `<link rel="stylesheet" href="/${f}" />`),
    ...[...preload].map((f) => `<link rel="modulepreload" href="/${f}" />`),
    `<script type="module" src="/${chunk.file}"></script>`,
  ].join('\n    ')
}
