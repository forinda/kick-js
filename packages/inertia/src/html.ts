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

export const defaultTemplate =
  (title: string): HtmlTemplate =>
  ({ head, body }) =>
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
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
  imports?: string[]
}

/** Production: the entry's script, its CSS, and the CSS and preloads of what it imports. */
export function manifestHead(clientDir: string, entry: string): string {
  const manifest = JSON.parse(
    readFileSync(join(clientDir, '.vite', 'manifest.json'), 'utf8'),
  ) as Record<string, ManifestChunk>
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
