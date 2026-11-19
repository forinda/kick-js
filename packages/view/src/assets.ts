/**
 * `@assets('src/client/main.ts')`: the tags a page needs for a Vite entry —
 * the dev client and module in dev, the hashed files from the build's
 * manifest in production.
 */
import { escapeHtml } from './render/safe'

/** One entry of a Vite build manifest. */
export interface ViteManifestChunk {
  file: string
  css?: string[]
  imports?: string[]
  isEntry?: boolean
}

/** A Vite build manifest (`.vite/manifest.json`), keyed by source path. */
export type ViteManifest = Record<string, ViteManifestChunk>

/** Dev (Vite's dev server under `base`) or production (the build's manifest). */
export type AssetsMode =
  | { dev: true; base: string }
  | { dev: false; manifest: ViteManifest; base: string }

/**
 * The `<script>` and `<link>` tags for a Vite entry: the Vite client and the entry module in dev,
 * the hashed script, stylesheets and module preloads from the manifest in production.
 * Throws when the entry isn't in the manifest.
 *
 * @see https://kickjs.app/guide/views/assets
 */
export function assetTags(entry: string, mode: AssetsMode, nonce?: string): string {
  const base = mode.base.endsWith('/') ? mode.base : `${mode.base}/`
  const n = nonce ? ` nonce="${escapeHtml(nonce)}"` : ''
  const url = (file: string) => escapeHtml(`${base}${file.replace(/^\//, '')}`)
  if (mode.dev) {
    return [
      `<script type="module"${n} src="${url('@vite/client')}"></script>`,
      `<script type="module"${n} src="${url(entry)}"></script>`,
    ].join('\n')
  }
  const chunk = mode.manifest[entry]
  if (!chunk) throw new Error(`@assets: '${entry}' isn't an entry in the Vite manifest`)
  const css = new Set<string>(chunk.css ?? [])
  const preload = new Set<string>()
  const walk = (key: string) => {
    const c = mode.manifest[key]
    if (!c || preload.has(c.file)) return
    preload.add(c.file)
    for (const s of c.css ?? []) css.add(s)
    for (const i of c.imports ?? []) walk(i)
  }
  for (const i of chunk.imports ?? []) walk(i)
  return [
    ...[...css].map((f) => `<link rel="stylesheet"${n} href="${url(f)}">`),
    ...[...preload].map((f) => `<link rel="modulepreload"${n} href="${url(f)}">`),
    `<script type="module"${n} src="${url(chunk.file)}"></script>`,
  ].join('\n')
}
