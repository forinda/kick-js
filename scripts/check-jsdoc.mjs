/**
 * Checks the JSDoc in every package's source:
 *
 * 1. No link a reader can't use: the design notes (`architecture.md`,
 *    `spec §N`; see .agents/AGENTS.md) or a repo path such as
 *    `docs/guide/x.md`. Link the site instead: https://kickjs.app/guide/x
 * 2. Every public decorator and adapter (an exported PascalCase function,
 *    or a PascalCase const made by a call) has JSDoc with a
 *    https://kickjs.app link, which is what an editor shows on hover.
 *
 * Usage: node scripts/check-jsdoc.mjs
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PACKAGES = join(ROOT, 'packages')
// Not libraries: the editor extension and its language server, and the
// DevTools browser app.
const SKIP_PACKAGES = new Set(['vscode-extension', 'view-language-server'])

const UNREACHABLE = [
  [/architecture\.md|devtools-flows\.md/, 'cites the design notes; link kickjs.app'],
  [/\bspec §|§2[0-3]\b|§21\./, 'cites a design-note section; link kickjs.app'],
  [
    /(?<!kickjs\.app\/)(?<![\w.-])docs\/(guide|api|recipes|examples)\//,
    'links a repo path, not the site',
  ],
]
// `export function Name(` or `export const Name = call(...)` — a decorator or
// an adapter factory. An all-caps const (`DB_PRIMARY`) is a token, skipped.
const PUBLIC_FACTORY =
  /^export (?:async )?function ([A-Z][A-Za-z0-9]*)\b|^export const ([A-Z][a-z][A-Za-z0-9]*)\s*(?::[^=]+)?=\s*[A-Za-z_.]+(?:<[^>]*>)?\(/

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'spa')
      continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) yield path
  }
}

/** The JSDoc block directly above `line` (blank lines and decorators allowed), or ''. */
function docAbove(lines, line) {
  let i = line - 1
  while (i >= 0 && (lines[i].trim() === '' || lines[i].trim().startsWith('//'))) i--
  if (i < 0 || !lines[i].trim().endsWith('*/')) return ''
  const end = i
  while (i >= 0 && !lines[i].trim().startsWith('/**')) i--
  return i < 0 ? '' : lines.slice(i, end + 1).join('\n')
}

const problems = []
for (const pkg of readdirSync(PACKAGES)) {
  if (SKIP_PACKAGES.has(pkg)) continue
  let files
  try {
    files = [...sourceFiles(join(PACKAGES, pkg, 'src'))]
  } catch {
    continue
  }
  for (const file of files) {
    const rel = relative(ROOT, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    const seen = new Set() // overloads: the first signature carries the JSDoc
    lines.forEach((text, i) => {
      for (const [re, why] of UNREACHABLE) {
        if (re.test(text)) problems.push(`${rel}:${i + 1}: ${why}`)
      }
      const m = PUBLIC_FACTORY.exec(text)
      if (!m) return
      const name = m[1] ?? m[2]
      if (seen.has(name)) return
      seen.add(name)
      const doc = docAbove(lines, i)
      if (!doc) problems.push(`${rel}:${i + 1}: ${name} has no JSDoc`)
      else if (!doc.includes('https://kickjs.app/')) {
        problems.push(`${rel}:${i + 1}: ${name}'s JSDoc has no https://kickjs.app link (@see)`)
      }
    })
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} JSDoc problem(s).`)
  process.exit(1)
}
