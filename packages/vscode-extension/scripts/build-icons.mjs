#!/usr/bin/env node
/**
 * Generate the marketplace PNG icon from `resources/icon-marketplace.svg`.
 *
 * The VS Code Marketplace requires a PNG at the path declared in
 * `package.json#icon` — SVG is not accepted there. This script keeps the
 * source of truth as SVG so design tweaks live in version control as
 * diffable XML, and the rendered PNG ships alongside the .vsix at build
 * time.
 *
 * Run via `pnpm build:icons` (wireit step). Idempotent — safe to re-run.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const SOURCES = [
  // [src svg, dest png, size]
  ['resources/icon-marketplace.svg', 'resources/icon.png', 128],
]

for (const [srcRel, destRel, size] of SOURCES) {
  const src = join(root, srcRel)
  const dest = join(root, destRel)
  const svg = readFileSync(src)
  mkdirSync(dirname(dest), { recursive: true })
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(dest)
  // eslint-disable-next-line no-console
  console.log(`build-icons: ${srcRel} -> ${destRel} (${size}x${size})`)
}
