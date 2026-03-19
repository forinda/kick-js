#!/usr/bin/env node

/**
 * KickJS Monorepo Release Script
 *
 * Bumps version in all package.json files, generates release notes from
 * commit log with contributor info and commit hashes, creates a git tag,
 * and optionally pushes + publishes.
 *
 * Usage:
 *   node scripts/release.js <patch|minor|major|prerelease|custom> [options]
 *
 * Options:
 *   --dry-run       Preview changes without executing
 *   --no-push       Skip git push
 *   --no-publish    Skip npm publish
 *   --tag <name>    Custom prerelease tag (default: alpha)
 *   --from <ref>    Generate notes from this ref (default: last tag)
 *
 * Examples:
 *   node scripts/release.js patch
 *   node scripts/release.js minor --dry-run
 *   node scripts/release.js prerelease --tag beta
 *   node scripts/release.js custom 1.0.0-rc.1
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// ── Configuration ───────────────────────────────────────────────────────

const REPO_URL = 'https://github.com/forinda/kick-js'
const NPM_SCOPE = '@kickjs'

// Packages to bump (order matters — deps first)
const PACKAGES = [
  'packages/core',
  'packages/config',
  'packages/http',
  'packages/swagger',
  'packages/cli',
  'packages/testing',
]

// Examples also get version bumped (but not published)
const EXAMPLES = [
  'examples/basic-api',
  'examples/auth-api',
  'examples/validated-api',
  'examples/full-api',
  'examples/swagger-api',
  'examples/joi-api',
]

const RELEASE_TYPES = ['patch', 'minor', 'major', 'prerelease', 'custom']

// ── Helpers ─────────────────────────────────────────────────────────────

function exec(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', ...opts }).trim()
}

function run(cmd, description) {
  console.log(`\n  ${description}...`)
  try {
    execSync(cmd, { stdio: 'inherit' })
    console.log(`  Done.`)
  } catch (err) {
    console.error(`  Failed: ${err.message}`)
    process.exit(1)
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
}

// ── Version Logic ───────────────────────────────────────────────────────

function getCurrentVersion() {
  return readJson('packages/core/package.json').version
}

function bumpVersion(current, type, tag = 'alpha') {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/)
  if (!match) throw new Error(`Cannot parse version: ${current}`)

  let [, major, minor, patch, preTag, preNum] = match
  major = Number(major)
  minor = Number(minor)
  patch = Number(patch)
  preNum = preNum !== undefined ? Number(preNum) : -1

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      // If currently a prerelease, just drop the prerelease tag
      if (preTag) return `${major}.${minor}.${patch}`
      return `${major}.${minor}.${patch + 1}`
    case 'prerelease':
      if (preTag === tag) return `${major}.${minor}.${patch}-${tag}.${preNum + 1}`
      return `${major}.${minor}.${patch + 1}-${tag}.0`
    default:
      throw new Error(`Unknown bump type: ${type}`)
  }
}

// ── Version Bumping ─────────────────────────────────────────────────────

function bumpAllPackages(newVersion, dryRun) {
  const files = ['package.json', ...PACKAGES.map((p) => `${p}/package.json`), ...EXAMPLES.map((e) => `${e}/package.json`)]

  console.log(`\n  Bumping all packages to ${newVersion}:`)

  for (const file of files) {
    const fullPath = path.resolve(file)
    if (!fs.existsSync(fullPath)) continue

    const pkg = readJson(fullPath)
    const oldVersion = pkg.version
    pkg.version = newVersion

    // Update workspace cross-references to show the version (for published packages)
    // workspace:* stays as-is — pnpm resolves it at install time

    if (!dryRun) {
      writeJson(fullPath, pkg)
    }
    console.log(`    ${file}: ${oldVersion} -> ${newVersion}`)
  }
}

// ── Git Helpers ──────────────────────────────────────────────────────────

function getLastTag() {
  try {
    return exec('git describe --tags --abbrev=0')
  } catch {
    try {
      return exec('git rev-list --max-parents=0 HEAD')
    } catch {
      return 'HEAD~20'
    }
  }
}

function getCommitsSince(ref) {
  try {
    const log = exec(
      `git log ${ref}..HEAD --no-merges --format="%H|%an|%ae|%s"`,
    )
    if (!log) return []
    return log.split('\n').map((line) => {
      const [hash, author, email, ...msgParts] = line.split('|')
      return {
        hash: hash.slice(0, 7),
        fullHash: hash,
        author,
        email,
        message: msgParts.join('|'),
      }
    })
  } catch {
    return []
  }
}

// ── Release Notes ───────────────────────────────────────────────────────

function categorizeCommits(commits) {
  const categories = {
    breaking: [],
    features: [],
    fixes: [],
    docs: [],
    chores: [],
    tests: [],
    ci: [],
  }

  for (const commit of commits) {
    const msg = commit.message.toLowerCase()
    if (msg.includes('breaking') || msg.includes('!:')) {
      categories.breaking.push(commit)
    } else if (msg.startsWith('feat')) {
      categories.features.push(commit)
    } else if (msg.startsWith('fix')) {
      categories.fixes.push(commit)
    } else if (msg.startsWith('docs')) {
      categories.docs.push(commit)
    } else if (msg.startsWith('test')) {
      categories.tests.push(commit)
    } else if (msg.startsWith('ci')) {
      categories.ci.push(commit)
    } else {
      categories.chores.push(commit)
    }
  }

  return categories
}

function formatCommit(commit) {
  return `- ${commit.message} (\`${commit.hash}\`) — @${commit.author}`
}

function generateReleaseNotes(version, fromRef) {
  const ref = fromRef || getLastTag()
  const commits = getCommitsSince(ref)

  if (commits.length === 0) {
    console.log('  No commits found since last tag.')
    return null
  }

  const categories = categorizeCommits(commits)

  // Collect unique contributors
  const contributors = new Map()
  for (const c of commits) {
    if (!contributors.has(c.email)) {
      contributors.set(c.email, c.author)
    }
  }

  let notes = `# Release v${version}\n\n`

  const sections = [
    { key: 'breaking', title: 'Breaking Changes' },
    { key: 'features', title: 'New Features' },
    { key: 'fixes', title: 'Bug Fixes' },
    { key: 'docs', title: 'Documentation' },
    { key: 'tests', title: 'Tests' },
    { key: 'ci', title: 'CI / Infrastructure' },
    { key: 'chores', title: 'Maintenance' },
  ]

  for (const { key, title } of sections) {
    const items = categories[key]
    if (items.length === 0) continue
    notes += `## ${title}\n\n`
    for (const commit of items) {
      notes += formatCommit(commit) + '\n'
    }
    notes += '\n'
  }

  // Contributors section
  notes += `## Contributors\n\n`
  for (const [email, name] of contributors) {
    const profileUrl = email.includes('noreply') ? null : `https://github.com/${name}`
    notes += profileUrl
      ? `- [${name}](${profileUrl})\n`
      : `- ${name}\n`
  }
  notes += '\n'

  // Stats
  notes += `## Stats\n\n`
  notes += `- **${commits.length}** commits\n`
  notes += `- **${contributors.size}** contributor(s)\n`
  notes += `- **${PACKAGES.length}** packages published\n`
  notes += '\n'

  // Links
  notes += `---\n\n`
  notes += `**Full Changelog**: ${REPO_URL}/compare/${ref}...v${version}\n`
  notes += `**Packages**: ${PACKAGES.map((p) => `\`${NPM_SCOPE}/${path.basename(p)}\``).join(', ')}\n`

  return notes
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const releaseType = args[0]
  const dryRun = args.includes('--dry-run')
  const noPush = args.includes('--no-push')
  const noPublish = args.includes('--no-publish')
  const tagIdx = args.indexOf('--tag')
  const preTag = tagIdx !== -1 ? args[tagIdx + 1] : 'alpha'
  const fromIdx = args.indexOf('--from')
  const fromRef = fromIdx !== -1 ? args[fromIdx + 1] : null

  if (!releaseType || !RELEASE_TYPES.includes(releaseType)) {
    console.log('KickJS Monorepo Release Script\n')
    console.log('Usage: node scripts/release.js <type> [options]\n')
    console.log('Types:')
    console.log('  patch        Bug fixes          (0.1.0 -> 0.1.1)')
    console.log('  minor        New features        (0.1.0 -> 0.2.0)')
    console.log('  major        Breaking changes     (0.1.0 -> 1.0.0)')
    console.log('  prerelease   Pre-release          (0.1.0 -> 0.1.1-alpha.0)')
    console.log('  custom X.Y.Z Set exact version\n')
    console.log('Options:')
    console.log('  --dry-run      Preview without changes')
    console.log('  --no-push      Skip git push')
    console.log('  --no-publish   Skip npm publish')
    console.log('  --tag <name>   Prerelease tag (default: alpha)')
    console.log('  --from <ref>   Generate notes from this git ref\n')
    console.log('Examples:')
    console.log('  node scripts/release.js patch')
    console.log('  node scripts/release.js minor --dry-run')
    console.log('  node scripts/release.js prerelease --tag beta')
    console.log('  node scripts/release.js custom 1.0.0-rc.1\n')
    console.log('Shorthand (from package.json):')
    console.log('  pnpm release:patch')
    console.log('  pnpm release:minor')
    console.log('  pnpm release:major')
    process.exit(1)
  }

  // Determine version
  const currentVersion = getCurrentVersion()
  let nextVersion

  if (releaseType === 'custom') {
    nextVersion = args[1]
    if (!nextVersion || !/^\d+\.\d+\.\d+/.test(nextVersion)) {
      console.error('Error: custom release requires a valid version (e.g. 1.0.0-rc.1)')
      process.exit(1)
    }
  } else {
    nextVersion = bumpVersion(currentVersion, releaseType, preTag)
  }

  console.log('KickJS Monorepo Release')
  console.log('='.repeat(50))
  console.log(`  Current:  ${currentVersion}`)
  console.log(`  Next:     ${nextVersion}`)
  console.log(`  Type:     ${releaseType}`)
  console.log(`  Packages: ${PACKAGES.length} framework + ${EXAMPLES.length} examples`)
  console.log(`  Dry run:  ${dryRun ? 'yes' : 'no'}`)
  console.log('='.repeat(50))

  // Pre-flight
  if (!dryRun) {
    const status = exec('git status --porcelain')
    if (status) {
      console.error('\nError: Working directory not clean. Commit or stash changes first.')
      process.exit(1)
    }
  }

  // Generate release notes first (before version bump changes the log)
  console.log('\nGenerating release notes...')
  const notes = generateReleaseNotes(nextVersion, fromRef)

  if (notes) {
    const notesFile = `RELEASE_NOTES_v${nextVersion}.md`
    if (!dryRun) {
      fs.writeFileSync(notesFile, notes)
    }
    console.log(`\n${'='.repeat(50)}`)
    console.log(notes)
    console.log('='.repeat(50))
    console.log(`  Saved to: ${notesFile}`)
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would execute:')
    bumpAllPackages(nextVersion, true)
    console.log(`  4. git add -A && git commit -m "chore: release v${nextVersion}"`)
    console.log(`  5. git tag v${nextVersion}`)
    if (!noPush) console.log('  6. git push --follow-tags')
    if (!noPublish) console.log('  7. pnpm -r publish --access public --no-git-checks')
    return
  }

  // Bump versions
  bumpAllPackages(nextVersion, false)

  // Build & test
  run('pnpm build', 'Building all packages')
  run('pnpm test', 'Running tests')

  // Commit
  const filesToStage = [
    'package.json',
    ...PACKAGES.map((p) => `${p}/package.json`),
    ...EXAMPLES.filter((e) => fs.existsSync(`${e}/package.json`)).map((e) => `${e}/package.json`),
  ]
  if (notes) filesToStage.push(`RELEASE_NOTES_v${nextVersion}.md`)

  run(`git add ${filesToStage.join(' ')}`, 'Staging version bumps')
  run(
    `git commit -m "chore: release v${nextVersion}"`,
    `Committing release v${nextVersion}`,
  )

  // Tag
  run(`git tag -a v${nextVersion} -m "Release v${nextVersion}"`, 'Creating annotated tag')

  // Push
  if (!noPush) {
    run('git push --follow-tags', 'Pushing to remote')
  } else {
    console.log('\n  Skipped push (--no-push)')
  }

  // Publish
  if (!noPublish) {
    run('pnpm -r publish --access public --no-git-checks', 'Publishing to npm')
  } else {
    console.log('\n  Skipped publish (--no-publish)')
  }

  // Done
  console.log(`\n${'='.repeat(50)}`)
  console.log(`  Released v${nextVersion}`)
  console.log(`  Tag:     v${nextVersion}`)
  console.log(`  Packages: ${PACKAGES.map((p) => `${NPM_SCOPE}/${path.basename(p)}`).join(', ')}`)
  console.log('='.repeat(50))

  console.log('\nTo create a GitHub Release:')
  console.log(`  ${REPO_URL}/releases/new?tag=v${nextVersion}&title=v${nextVersion}`)
  if (notes) {
    console.log(`  Paste content from RELEASE_NOTES_v${nextVersion}.md`)
  }

  console.log('\nOr use gh CLI:')
  console.log(`  gh release create v${nextVersion} --title "v${nextVersion}" --notes-file RELEASE_NOTES_v${nextVersion}.md`)
}

main()
