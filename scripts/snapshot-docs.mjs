#!/usr/bin/env node
/**
 * Snapshot the live `docs/` tree into `docs/versions/<version>/`.
 *
 * Run on its own cadence — independent of `changeset version`.
 * Cut a docs snapshot when prose has materially changed and you
 * want to pin "the docs as of vX.Y" for the version switcher.
 * Most patch releases ship zero doc-shape changes and need no snapshot.
 *
 * Usage:
 *   pnpm docs:snapshot                       # use @forinda/kickjs version
 *   pnpm docs:snapshot -- --version 5.3.0    # explicit version
 *   pnpm docs:snapshot -- --force            # overwrite existing snapshot
 *
 * The directory name conventionally tracks the `@forinda/kickjs` core
 * version because that's the version adopters cite, but `--version`
 * accepts any string for special cuts (e.g. `5.3.0-rewrite`).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const args = process.argv.slice(2)
const flag = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(`--${name}=`.length)
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1]
  return undefined
}
const has = (name) => args.includes(`--${name}`)

const explicit = flag('version')
const force = has('force')

let version = explicit
if (!version) {
  const corePkg = JSON.parse(readFileSync(join(repoRoot, 'packages/kickjs/package.json'), 'utf-8'))
  version = corePkg.version
}

if (!version || version === '0.0.0') {
  console.log(`  snapshot-docs: skipped (resolved version is ${version})`)
  process.exit(0)
}

const target = join(repoRoot, 'docs/versions', version)
if (existsSync(target) && statSync(target).isDirectory()) {
  if (!force) {
    console.log(`  snapshot-docs: ${target} exists — skipping (pass --force to overwrite)`)
    process.exit(0)
  }
  rmSync(target, { recursive: true, force: true })
  console.log(`  snapshot-docs: removed existing ${target} (--force)`)
}

mkdirSync(target, { recursive: true })

const docsRoot = join(repoRoot, 'docs')
// Top-level content directories + standalone files. Anything under
// `docs/.vitepress/`, `docs/versions/`, `docs/public/` stays out;
// versioned docs only reproduce content pages.
const dirs = ['guide', 'api', 'examples']
const files = ['changelog.md', 'roadmap.md', 'index.md']

for (const dir of dirs) {
  const src = join(docsRoot, dir)
  if (existsSync(src)) {
    cpSync(src, join(target, dir), { recursive: true })
  }
}

for (const file of files) {
  const src = join(docsRoot, file)
  if (existsSync(src)) {
    cpSync(src, join(target, file))
  }
}

console.log(`  snapshot-docs: wrote ${target} (kickjs@${version})`)
console.log(`  next: pnpm format && git add docs/versions/${version} && commit`)
