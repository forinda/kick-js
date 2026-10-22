/**
 * Client scripts: a component's `<script client>`, served as a module of its
 * own. A build ships them as plain JS; otherwise their types are stripped
 * here, with Node's own stripper, the first time a page needs one.
 */

/** FNV-1a, 32-bit, as 8 hex characters: names a script by its content. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Strip TypeScript types with Node's `stripTypeScriptTypes` (Node 22.13+). */
export async function defaultStripTypes(code: string): Promise<string> {
  // Named at runtime so a bundle for an edge runtime never tries to resolve
  // it: built bundles carry plain JS and never get here.
  const specifier = 'node:module'
  const mod = (await import(/* @vite-ignore */ specifier).catch(() => undefined)) as
    | { stripTypeScriptTypes?: (code: string) => string }
    | undefined
  if (!mod?.stripTypeScriptTypes)
    throw new Error('client scripts need Node 22.13+ to strip TypeScript, or a kick build')
  return mod.stripTypeScriptTypes(code)
}

/** `<tag>.<hash>.js` */
export const CLIENT_SCRIPT_FILE = /^([a-z][a-z0-9-]*)\.([0-9a-f]{8})\.js$/

/** Insert `tags` before the last `</body>`, or at the end when there's none. */
export function injectScripts(html: string, tags: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>')
  return at < 0 ? html + tags : html.slice(0, at) + tags + html.slice(at)
}
