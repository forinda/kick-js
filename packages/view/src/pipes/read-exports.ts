/**
 * Read the names a pipes file exports, without running it — so the build
 * and the editor agree with the runtime on which pipes exist (spec §7).
 * Only top-level `export const|let|var|function` and `export { a, b as c }`
 * of local names; anything that needs another module to resolve is refused.
 */
import { error, positionAt, type Diagnostic } from '../diagnostics'
import { BUILTIN_PIPES } from './builtins'

interface Token {
  v: string
  start: number
}

/** Identifiers and punctuation at brace depth 0, skipping strings, comments and template literals. */
function topLevelTokens(src: string): Token[] {
  const out: Token[] = []
  let depth = 0
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === '{' || c === '(' || c === '[') {
      if (depth === 0) out.push({ v: c, start: i })
      depth++
      i++
      continue
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--
      if (depth === 0) out.push({ v: c, start: i })
      i++
      continue
    }
    if (depth === 0 && /[A-Za-z_$*]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*|^\*/.exec(src.slice(i))!
      out.push({ v: m[0], start: i })
      i += m[0].length
      continue
    }
    if (depth === 0 && (c === ',' || c === ';' || c === '=')) out.push({ v: c, start: i })
    i++
  }
  return out
}

/** The tokens inside the `{ … }` that starts at `src[open]`. */
function braceNames(
  src: string,
  open: number,
): { names: Array<{ local: string; exported: string; at: number }>; end: number } {
  const close = src.indexOf('}', open)
  const body = src.slice(open + 1, close < 0 ? src.length : close)
  const names: Array<{ local: string; exported: string; at: number }> = []
  let offset = open + 1
  for (const part of body.split(',')) {
    const m = /^(\s*)([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part)
    if (m) names.push({ local: m[2]!, exported: m[3] ?? m[2]!, at: offset + m[1]!.length })
    offset += part.length + 1
  }
  return { names, end: close < 0 ? src.length : close + 1 }
}

export function readPipeExports(
  source: string,
  file: string,
): { names: string[]; diagnostics: Diagnostic[] } {
  const names: string[] = []
  const diagnostics: Diagnostic[] = []
  const fail = (at: number, len: number, message: string) =>
    diagnostics.push(
      error(file, { start: positionAt(source, at), end: positionAt(source, at + len) }, message),
    )
  const add = (name: string, at: number) => {
    if (BUILTIN_PIPES.includes(name)) {
      fail(at, name.length, `'${name}' is a built-in pipe — choose another name`)
      return
    }
    names.push(name)
  }

  const tokens = topLevelTokens(source)
  for (let t = 0; t < tokens.length; t++) {
    if (tokens[t]!.v !== 'export') continue
    const at = tokens[t]!.start
    const next = tokens[t + 1]
    const after = tokens[t + 2]
    switch (next?.v) {
      case 'const':
      case 'let':
      case 'var': {
        if (after && /^[A-Za-z_$]/.test(after.v)) add(after.v, after.start)
        else fail(at, 6, 'export one pipe per name: export const name = …')
        break
      }
      case 'function':
        if (after && /^[A-Za-z_$]/.test(after.v)) add(after.v, after.start)
        break
      case 'async':
        fail(at, 6, 'pipes must be synchronous — an async function returns a Promise')
        break
      case '{': {
        const { names: list, end } = braceNames(source, next.start)
        const rest = tokens.find((x) => x.start >= end)
        if (rest?.v === 'from') {
          fail(at, 6, "re-exports aren't read — import the pipe and export it from this file")
          break
        }
        for (const n of list) add(n.exported, n.at)
        break
      }
      case 'type':
      case 'interface':
        break
      case '*':
        fail(at, 6, "export * isn't read — export each pipe by name")
        break
      case 'default':
        fail(at, 6, 'a default export is not a pipe — export each pipe by name')
        break
      default:
        fail(at, 6, `export ${next?.v ?? ''} is not a pipe — export const or function`)
    }
  }
  return { names, diagnostics }
}
