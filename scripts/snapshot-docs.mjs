#!/usr/bin/env node
/**
 * Snapshot the live `docs/` tree into `docs/versions/<version>/`.
 *
 * Runs from `pnpm changeset:version` after the changesets bump, so
 * the snapshot directory name reflects the just-released version of
 * `@forinda/kickjs` (the framework core that drives the docs site's
 * version switcher). Per-package versions diverge under changesets;
 * the docs site tracks a single timeline anchored on the core
 * package because that's the version adopters cite.
 *
 * Idempotent: if the target directory already exists (re-running
 * `changeset version` after a manual fix), the existing snapshot is
 * left in place. Adopters who really need to re-snapshot can `rm -rf`
 * the directory first.
 *
 * Adopted from the previous lockstep `scripts/release.js` flow; the
 * snapshot logic is the only part of that script that survived the
 * changesets migration.
 */

import { existsSync, mkdirSync, readFileSync, statSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const corePkg = JSON.parse(readFileSync(join(repoRoot, 'packages/kickjs/package.json'), 'utf-8'))
const version = corePkg.version

if (!version || version === '0.0.0') {
  console.log(`  snapshot-docs: skipped (core package version is ${version})`)
  process.exit(0)
}

const target = join(repoRoot, 'docs/versions', version)
if (existsSync(target) && statSync(target).isDirectory()) {
  console.log(`  snapshot-docs: ${target} exists — skipping (idempotent)`)
  process.exit(0)
}

mkdirSync(target, { recursive: true })

const docsRoot = join(repoRoot, 'docs')
// Same set the legacy script copied — top-level guide / api / examples
// directories plus a few standalone files. Anything under
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
