/**
 * Client scripts: a component's `<script client>`, served as a module of its
 * own. A build ships them as plain JS; otherwise the Node entry's stripper
 * (`./strip-types`) strips their types the first time a page needs one.
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

/** `<name>.<hash>.js`: a component's own script, or a bundled entry or chunk. Nothing but one `.js`. */
export const CLIENT_SCRIPT_FILE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{8})\.(js|css)$/

/** `import … from`, `export … from` or `import(`: a script that needs a bundler. */
const IMPORTS =
  /(^|[\n;])\s*import[\s{*'"]|\bimport\s*\(|(^|[\n;])\s*export\s*(\*(\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]/

// ponytail: no `${}` nesting or regex literals; a real lexer if those cause false hits.
const NOISE =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g

/** Whether a script imports: searched with comments removed and strings emptied. */
export const hasImports = (code: string): boolean =>
  IMPORTS.test(code.replace(NOISE, (m) => (m[0] === '/' ? '\n' : m[0]! + m[0])))

/** Insert `tags` before the last `</body>`, or at the end when there's none. */
export function injectScripts(html: string, tags: string): string {
  // A case-insensitive search of the text itself: lowercasing can change its
  // length (`İ` becomes two units) and move the offset.
  let at = -1
  for (const m of html.matchAll(/<\/body\s*>/gi)) at = m.index
  return at < 0 ? html + tags : html.slice(0, at) + tags + html.slice(at)
}

/** Insert `tags` before the first `</head>`, or as `injectScripts` does when there's none. */
export function injectHead(html: string, tags: string): string {
  const at = /<\/head\s*>/i.exec(html)?.index ?? -1
  return at < 0 ? injectScripts(html, tags) : html.slice(0, at) + tags + html.slice(at)
}

export const NO_STRIPPER = 'client scripts need Node 22.13+ to strip TypeScript, or a kick build'
