#!/usr/bin/env node

// ESM wrapper for the ESM CLI entry.
// Bin entries must be plain .js (not .mjs) for universal Node.js compatibility.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// A `kick` installed elsewhere (globally, or in a parent folder) run inside a
// project hands off to the project's own CLI. Otherwise both copies of
// @forinda/kickjs load into one process — this CLI's and the one kick.config.ts
// imports — each with its own DI container, and the project's version is the
// one that should answer.
function projectCli() {
  const self = realpathSync(dirname(fileURLToPath(import.meta.url)))
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const pkg = join(dir, 'node_modules', '@forinda', 'kickjs-cli', 'package.json')
    if (existsSync(pkg)) {
      const root = realpathSync(dirname(pkg))
      if (root === self) return undefined
      const bin = JSON.parse(readFileSync(pkg, 'utf8')).bin
      const file = typeof bin === 'string' ? bin : bin?.kick
      return file ? join(root, file) : undefined
    }
    if (dirname(dir) === dir) return undefined
  }
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
