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
 *   --dry-run          Preview changes without executing
 *   --no-push          Skip git push
 *   --no-publish       Skip npm publish
 *   --github-release   Create a GitHub release via gh CLI with release notes
 *   --tag <name>       Custom prerelease tag (default: alpha)
 *   --from <ref>       Generate notes from this ref (default: last tag)
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
const NPM_SCOPE = '@forinda/kickjs'

// Packages to bump (order matters — deps first)
const PACKAGES = [
  'packages/core',
  'packages/config',
  'packages/http',
  'packages/auth',
  'packages/cron',
  'packages/devtools',
  'packages/drizzle',
  'packages/graphql',
  'packages/mailer',
  'packages/multi-tenant',
  'packages/notifications',
  'packages/otel',
  'packages/prisma',
  'packages/queue',
  'packages/swagger',
  'packages/cli',
  'packages/testing',
  'packages/ws',
  'packages/vscode-extension',
]

// Examples also get version bumped (but not published)
const EXAMPLES = [
  'examples/devtools-api',
  'examples/graphql-api',
  'examples/joi-api',
  'examples/microservice-api',
  'examples/minimal-api',
  'examples/otel-api',
  'examples/jira-drizzle-api',
  'examples/jira-mongoose-api',
  'examples/jira-prisma-api',
  'examples/jira-prisma-v7-api',
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

/** Derive the npm dist-tag from a version string */
function getDistTag(version) {
  if (!version.includes('-')) return 'latest'
  const match = version.match(/-([0-9A-Za-z-]+)(?:\.|$)/)
  if (!match) {
    throw new Error(
      `Unsupported prerelease version format "${version}". Expected a valid semver prerelease like "1.2.3-alpha" or "1.2.3-alpha.0".`,
    )
  }
  return match[1]
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
  const hashLink = `[${commit.hash}](${REPO_URL}/commit/${commit.fullHash})`
  const authorLink = commit.email.includes('noreply')
    ? `@${commit.author}`
    : `[@${commit.author}](https://github.com/${commit.author})`
  return `- ${commit.message} (${hashLink}) — ${authorLink}`
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
  notes += `**Packages**: ${PACKAGES.map((p) => `\`${NPM_SCOPE}-${path.basename(p)}\``).join(', ')}\n`

  return notes
}

// ── Interactive Prompt ──────────────────────────────────────────────────

const readline = require('readline')

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function interactiveRelease() {
  const currentVersion = getCurrentVersion()
  const branch = exec('git branch --show-current')

  console.log('\n🚀 KickJS Interactive Release')
  console.log('='.repeat(50))
  console.log(`  Current version: ${currentVersion}`)
  console.log(`  Branch:          ${branch}`)
  console.log(`  Packages:        ${PACKAGES.length} framework + ${EXAMPLES.length} examples`)
  console.log('='.repeat(50))

  // 1. Release type
  console.log('\n  Release type:')
  console.log('    1) patch       — Bug fixes')
  console.log('    2) minor       — New features')
  console.log('    3) major       — Breaking changes')
  console.log('    4) prerelease  — Alpha/beta/rc')
  console.log('    5) custom      — Set exact version')

  const typeChoice = await ask('\n  Choose (1-5): ')
  const typeMap = { '1': 'patch', '2': 'minor', '3': 'major', '4': 'prerelease', '5': 'custom' }
  const releaseType = typeMap[typeChoice]
  if (!releaseType) {
    console.error('  Invalid choice.')
    process.exit(1)
  }

  // 2. Pre-release tag (if prerelease)
  let preTag = 'alpha'
  if (releaseType === 'prerelease') {
    console.log('\n  Pre-release channel:')
    console.log('    1) alpha')
    console.log('    2) beta')
    console.log('    3) rc')
    console.log('    4) custom')
    const tagChoice = await ask('\n  Choose (1-4): ')
    const tagMap = { '1': 'alpha', '2': 'beta', '3': 'rc' }
    if (tagChoice === '4') {
      preTag = await ask('  Custom tag: ')
      if (!preTag || !/^[a-z]+$/.test(preTag)) {
        console.error('  Invalid tag. Must be lowercase letters only (e.g. next, canary, dev).')
        process.exit(1)
      }
    } else {
      preTag = tagMap[tagChoice] || 'alpha'
    }
  }

  // 3. Custom version (if custom)
  let customVersion = null
  if (releaseType === 'custom') {
    customVersion = await ask('\n  Enter version (e.g. 2.0.0-rc.1): ')
    if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+(\.\d+)?)?$/.test(customVersion)) {
      console.error('  Invalid version format. Expected: X.Y.Z, X.Y.Z-tag, or X.Y.Z-tag.N (e.g. 2.0.0, 1.5.0-alpha, 1.5.0-rc.1)')
      process.exit(1)
    }
  }

  const nextVersion = releaseType === 'custom'
    ? customVersion
    : bumpVersion(currentVersion, releaseType, preTag)

  // 4. Options
  console.log(`\n  Version: ${currentVersion} → ${nextVersion}`)
  const dryRunAnswer = await ask('  Dry run? (y/N): ')
  const dryRun = dryRunAnswer.toLowerCase() === 'y'

  // In dry-run mode, nothing is pushed or published — reflect that in the summary
  let noPush = dryRun
  let noPublish = dryRun
  let githubRelease = false

  if (!dryRun) {
    const pushAnswer = await ask('  Push to remote? (Y/n): ')
    noPush = pushAnswer.toLowerCase() === 'n'

    const publishAnswer = await ask('  Publish to npm? (Y/n): ')
    noPublish = publishAnswer.toLowerCase() === 'n'

    const ghAnswer = await ask('  Create GitHub release? (Y/n): ')
    githubRelease = ghAnswer.toLowerCase() !== 'n'
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('  Release Summary:')
  console.log(`    Type:            ${releaseType}${releaseType === 'prerelease' ? ` (${preTag})` : ''}`)
  console.log(`    Version:         ${currentVersion} → ${nextVersion}`)
  console.log(`    Dry run:         ${dryRun ? 'yes' : 'no'}`)
  console.log(`    Push:            ${noPush ? 'no' : 'yes'}`)
  console.log(`    Publish to npm:  ${noPublish ? 'no' : 'yes'}`)
  console.log(`    GitHub release:  ${githubRelease ? 'yes' : 'no'}`)
  console.log('='.repeat(50))

  const confirm = await ask('\n  Proceed? (y/N): ')
  if (confirm.toLowerCase() !== 'y') {
    console.log('  Aborted.')
    process.exit(0)
  }

  // Build the equivalent args and call main logic
  const fakeArgs = [releaseType]
  if (releaseType === 'custom') fakeArgs.push(nextVersion)
  if (dryRun) fakeArgs.push('--dry-run')
  if (noPush) fakeArgs.push('--no-push')
  if (noPublish) fakeArgs.push('--no-publish')
  if (githubRelease) fakeArgs.push('--github-release')
  if (releaseType === 'prerelease') fakeArgs.push('--tag', preTag)

  return fakeArgs
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  let args = process.argv.slice(2)

  // Interactive mode when no args provided
  if (args.length === 0) {
    args = await interactiveRelease()
  }

  const releaseType = args[0]
  const dryRun = args.includes('--dry-run')
  const noPush = args.includes('--no-push')
  const noPublish = args.includes('--no-publish')
  const githubRelease = args.includes('--github-release')
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
    console.log('  --dry-run          Preview without changes')
    console.log('  --no-push          Skip git push')
    console.log('  --no-publish       Skip npm publish')
    console.log('  --github-release   Create GitHub release via gh CLI')
    console.log('  --tag <name>       Prerelease tag (default: alpha)')
    console.log('  --from <ref>       Generate notes from this git ref\n')
    console.log('Or run with no arguments for interactive mode.\n')
    console.log('Examples:')
    console.log('  node scripts/release.js               # interactive')
    console.log('  node scripts/release.js patch')
    console.log('  node scripts/release.js minor --dry-run')
    console.log('  node scripts/release.js prerelease --tag beta')
    console.log('')
    console.log('Shorthand via pnpm scripts:')
    console.log('  pnpm release:patch       # patch bump')
    console.log('  pnpm release:minor       # minor bump')
    console.log('  pnpm release:major       # major bump')
    console.log('  pnpm release:patch:gh    # patch + GitHub release')
    console.log('  pnpm release:minor:gh    # minor + GitHub release')
    console.log('  pnpm release:major:gh    # major + GitHub release')
    console.log('  pnpm release:alpha       # alpha prerelease')
    console.log('  pnpm release:beta        # beta prerelease')
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
    const branch = exec('git branch --show-current')
    const isPrerelease = nextVersion.includes('-')
    const allowedBranches = isPrerelease ? ['main', 'dev'] : ['main']
    if (!allowedBranches.includes(branch)) {
      console.error(`\nError: ${isPrerelease ? 'Pre-releases' : 'Stable releases'} must be made from ${allowedBranches.join(' or ')}. Current branch: ${branch}`)
      process.exit(1)
    }

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
    console.log(`  4. Update docs/changelog.md with release notes`)
    console.log(`  5. Snapshot docs → docs/versions/${nextVersion}/`)
    console.log(`  6. git add -A && git commit -m "chore: release v${nextVersion}"`)
    console.log(`  7. git tag v${nextVersion}`)
    if (!noPush) console.log('  8. git push --follow-tags')
    if (githubRelease) console.log(`  9. gh release create v${nextVersion} --title "v${nextVersion}" --notes-file RELEASE_NOTES_v${nextVersion}.md`)
    if (!noPublish) console.log(`  ${githubRelease ? '10' : '9'}. pnpm --filter='./packages/*' publish --access public --no-git-checks --tag ${getDistTag(nextVersion)}`)
    return
  }

  // Bump versions
  bumpAllPackages(nextVersion, false)

  // Build & test
  run('pnpm build', 'Building all packages')
  run('pnpm test', 'Running tests')

  // Update docs/changelog.md with release notes
  if (notes) {
    const changelogPath = path.join('docs', 'changelog.md')
    if (fs.existsSync(changelogPath)) {
      const existing = fs.readFileSync(changelogPath, 'utf-8')
      const header = '# Changelog\n\nAll notable changes to KickJS are documented here.\n\n'
      const body = existing.replace(header, '')
      fs.writeFileSync(changelogPath, header + notes + '\n\n' + body)
      console.log('  Updated docs/changelog.md')
    }
  }

  // Snapshot docs for versioning
  const docsSnapshotDir = path.join('docs', 'versions', nextVersion)
  const docsContentDirs = ['guide', 'api', 'examples']
  const docsContentFiles = ['changelog.md', 'roadmap.md', 'index.md']

  console.log(`\n  Snapshotting docs → ${docsSnapshotDir}/`)
  fs.mkdirSync(docsSnapshotDir, { recursive: true })

  for (const dir of docsContentDirs) {
    const src = path.join('docs', dir)
    if (fs.existsSync(src)) {
      run(`cp -r ${src} ${path.join(docsSnapshotDir, dir)}`, `  Copying docs/${dir}/`)
    }
  }
  for (const file of docsContentFiles) {
    const src = path.join('docs', file)
    if (fs.existsSync(src)) {
      run(`cp ${src} ${path.join(docsSnapshotDir, file)}`, `  Copying docs/${file}`)
    }
  }

  // Commit
  const filesToStage = [
    'package.json',
    ...PACKAGES.map((p) => `${p}/package.json`),
    ...EXAMPLES.filter((e) => fs.existsSync(`${e}/package.json`)).map((e) => `${e}/package.json`),
    docsSnapshotDir,
    'docs/changelog.md',
  ]
  // Note: RELEASE_NOTES file is gitignored — used for GitHub Release body, not committed

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

  // GitHub Release
  if (githubRelease) {
    if (noPush) {
      console.log('\n  Skipped GitHub release (--no-push — tag not pushed)')
    } else {
      const notesFile = `RELEASE_NOTES_v${nextVersion}.md`
      const isPrerelease = /-(alpha|beta|rc)\.\d+$/.test(nextVersion)
      const ghCmd = [
        'gh release create',
        `v${nextVersion}`,
        `--title "v${nextVersion}"`,
        notes && fs.existsSync(notesFile)
          ? `--notes-file ${notesFile}`
          : '--generate-notes',
        isPrerelease ? '--prerelease' : '',
      ]
        .filter(Boolean)
        .join(' ')
      run(ghCmd, `Creating GitHub release v${nextVersion}`)
    }
  }

  // Publish
  if (!noPublish) {
    const distTag = getDistTag(nextVersion)
    run(`pnpm --filter='./packages/*' publish --access public --no-git-checks --tag ${distTag}`, `Publishing to npm (dist-tag: ${distTag})`)
  } else {
    console.log('\n  Skipped publish (--no-publish)')
  }

  // Done
  console.log(`\n${'='.repeat(50)}`)
  console.log(`  Released v${nextVersion}`)
  console.log(`  Tag:     v${nextVersion}`)
  console.log(`  Packages: ${PACKAGES.map((p) => `${NPM_SCOPE}-${path.basename(p)}`).join(', ')}`)
  if (githubRelease && !noPush) {
    console.log(`  GitHub:  ${REPO_URL}/releases/tag/v${nextVersion}`)
  }
  console.log('='.repeat(50))

  if (!githubRelease) {
    console.log('\nTo create a GitHub Release:')
    console.log(`  ${REPO_URL}/releases/new?tag=v${nextVersion}&title=v${nextVersion}`)
    if (notes) {
      console.log(`  Paste content from RELEASE_NOTES_v${nextVersion}.md`)
    }

    console.log('\nOr use gh CLI:')
    console.log(`  gh release create v${nextVersion} --title "v${nextVersion}" --notes-file RELEASE_NOTES_v${nextVersion}.md`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
