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

/** `<name>.<hash>.<ext>`: a component's own script, a bundled entry or chunk, or its CSS, image or font. */
export const CLIENT_SCRIPT_FILE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{8})\.([a-z0-9]{1,16})$/

const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
}

/** A client file's `Content-Type`, by extension. */
export const contentType = (file: string): string =>
  TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream'

/** `import … from`, `export … from` or `import(`: a script that needs a bundler. */
const IMPORTS =
  /(^|[\n;])\s*import[\s{*'"]|\bimport\s*\(|(^|[\n;])\s*export\s*(\*(\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]/

// ponytail: a template literal nested inside `${}` or a regex literal can confuse it; a real lexer if those bite.
const NOISE =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g

/** Whether a script imports: searched with comments removed and strings emptied. */
export function hasImports(code: string): boolean {
  // A template literal's `${…}` parts are code: checked on their own.
  const parts: string[] = []
  const masked = code.replace(NOISE, (m) => {
    if (m[0] === '/') return '\n'
    if (m[0] === '`') parts.push(...templateExpressions(m))
    return m[0]! + m[0]
  })
  return IMPORTS.test(masked) || parts.some(hasImports)
}

/** The `${…}` expressions of a template literal, by brace depth. */
function templateExpressions(literal: string): string[] {
  const out: string[] = []
  for (let i = 0; i < literal.length; i++) {
    if (literal[i] === '\\') i++
    else if (literal[i] === '$' && literal[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      for (; j < literal.length && depth; j++)
        depth += literal[j] === '{' ? 1 : literal[j] === '}' ? -1 : 0
      out.push(literal.slice(i + 2, j - 1))
      i = j - 1
    }
  }
  return out
}

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
