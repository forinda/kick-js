#!/usr/bin/env node

// ESM wrapper for the ESM CLI entry.
// Bin entries must be plain .js (not .mjs) for universal Node.js compatibility.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// A `kick` installed elsewhere (globally, or in a parent folder) run inside a
// project hands off to the project's own CLI. Otherwise both copies of
// @forinda/kickjs load into one process — this CLI's and the one kick.config.ts
// imports — each with its own DI container, and the project's version is the
// one that should answer.
//
// Only the project the command runs in counts: the nearest folder with a
// package.json, which has to list @forinda/kickjs-cli (as `kick new` writes it)
// and belong to the user running kick. It never looks past that folder, so a
// node_modules in a parent (/tmp, a shared drive) is never run.
// KICK_NO_HANDOFF=1 opts out.
function projectCli() {
  if (process.env.KICK_NO_HANDOFF === '1') return undefined
  let dir = process.cwd()
  while (!existsSync(join(dir, 'package.json'))) {
    if (dirname(dir) === dir) return undefined
    dir = dirname(dir)
  }
  if (process.getuid && statSync(dir).uid !== process.getuid()) return undefined
  const { dependencies, devDependencies } = JSON.parse(
    readFileSync(join(dir, 'package.json'), 'utf8'),
  )
  if ({ ...dependencies, ...devDependencies }['@forinda/kickjs-cli'] === undefined) return undefined
  const pkg = join(dir, 'node_modules', '@forinda', 'kickjs-cli', 'package.json')
  if (!existsSync(pkg)) return undefined
  const root = realpathSync(dirname(pkg))
  if (root === realpathSync(dirname(fileURLToPath(import.meta.url)))) return undefined
  const bin = JSON.parse(readFileSync(pkg, 'utf8')).bin
  const file = typeof bin === 'string' ? bin : bin?.kick
  if (typeof file !== 'string') return undefined
  const target = realpathSync(join(root, file))
  // The bin has to live in the package it came from.
  return target.startsWith(root + sep) ? target : undefined
}

let local
try {
  local = projectCli()
} catch {
  // Unreadable package.json or the like: run this copy.
}

import(local ? pathToFileURL(local).href : './dist/cli.mjs').catch((err) => {
  console.error('Failed to load CLI:', err)
  process.exit(1)
})
