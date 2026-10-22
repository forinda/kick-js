#!/usr/bin/env node
/**
 * Release a new extension version as a PR: bumps `package.json`, turns the
 * CHANGELOG's `## Unreleased` section into the new version, and opens the PR
 * from a `chore/vscode-<version>` branch off an up-to-date main. The package
 * is private, so changesets never versions it.
 *
 *   pnpm release <patch|minor|major|x.y.z> [--dry]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const logPath = join(root, 'CHANGELOG.md')
const [bump, flag] = process.argv.slice(2)
const dry = flag === '--dry'

const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}
const run = (cmd, ...args) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  }).trim()

const pkg = readFileSync(pkgPath, 'utf8')
const current = JSON.parse(pkg).version
const [maj, min, pat] = current.split('.').map(Number)
const next =
  bump === 'major'
    ? `${maj + 1}.0.0`
    : bump === 'minor'
      ? `${maj}.${min + 1}.0`
      : bump === 'patch'
        ? `${maj}.${min}.${pat + 1}`
        : /^\d+\.\d+\.\d+$/.test(bump ?? '')
          ? bump
          : fail('usage: pnpm release <patch|minor|major|x.y.z> [--dry]')

const log = readFileSync(logPath, 'utf8')
if (!/^## Unreleased$/m.test(log)) fail('CHANGELOG.md has no "## Unreleased" section to release')

console.log(`forinda-kickjs-devtools ${current} -> ${next}`)
if (dry) process.exit(0)

if (run('git', 'status', '--porcelain')) fail('working tree not clean')
const branch = `chore/vscode-${next}`
run('git', 'checkout', 'main')
run('git', 'pull', '--ff-only')
run('git', 'checkout', '-b', branch)

writeFileSync(pkgPath, pkg.replace(`"version": "${current}"`, `"version": "${next}"`))
writeFileSync(logPath, log.replace(/^## Unreleased$/m, `## ${next}`))

const title = `chore(vscode): release ${next}`
run('git', 'commit', '-am', title)
run('git', 'push', '-u', 'origin', branch)
console.log(
  run(
    'gh',
    'pr',
    'create',
    '--base',
    'main',
    '--title',
    title,
    '--body',
    `Bumps the VS Code extension to ${next}. After merge: \`pnpm package\` in packages/vscode-extension, then publish.`,
  ),
)
