#!/usr/bin/env node
/**
 * `kick-lint` CLI entry. Wraps {@link runLint} from the package's
 * programmatic API with argv parsing + process exit translation.
 *
 * Usage:
 *   kick-lint                       lint adopter project (cwd, scope=src)
 *   kick-lint --first-party         lint framework code (cwd, scope=packages)
 *   kick-lint --scope src,libs      override scoped subdirectories
 *   kick-lint --cwd /path/to/repo   override working directory
 */

import { runLint, formatViolations } from './dist/index.mjs'
import process from 'node:process'

const args = process.argv.slice(2)
let cwd = process.cwd()
let firstParty = false
let scope = ['src']

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--first-party') {
    firstParty = true
    if (scope.length === 1 && scope[0] === 'src') scope = ['packages']
  } else if (arg === '--scope') {
    const next = args[++i]
    if (!next) {
      console.error('kick-lint: --scope requires a value')
      process.exit(2)
    }
    scope = next
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  } else if (arg === '--cwd') {
    const next = args[++i]
    if (!next) {
      console.error('kick-lint: --cwd requires a value')
      process.exit(2)
    }
    cwd = next
  } else if (arg === '--help' || arg === '-h') {
    console.log(
      'Usage: kick-lint [--first-party] [--scope dir1,dir2] [--cwd path]\n' +
        '\n' +
        '  --first-party   enable framework-strict ruleset (default scope: packages)\n' +
        '  --scope <dirs>  comma-separated subdirectories to walk (default: src)\n' +
        '  --cwd <path>    working directory override\n',
    )
    process.exit(0)
  } else {
    console.error(`kick-lint: unknown arg ${arg}`)
    process.exit(2)
  }
}

const result = await runLint({ cwd, firstParty, scope })
const errors = result.violations.filter((v) => v.severity === 'error').length

if (result.violations.length === 0) {
  console.log(`kick-lint: ${result.filesScanned} file(s) scanned, no violations`)
  process.exit(0)
}

console.error(formatViolations(result.violations))
process.exit(errors > 0 ? 1 : 0)
