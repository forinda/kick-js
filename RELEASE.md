# Release Guide

## Prerequisites

1. Clean working directory (`git status` shows no changes)
2. On `main` or `dev` branch
3. npm token configured:
   ```bash
   # Option 1: npm login
   npm login

   # Option 2: set token directly
   echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN" >> ~/.npmrc
   ```
4. GitHub `NPM_TOKEN` secret set (for CI-triggered publishes):
   - Repo Settings > Secrets > Actions > `NPM_TOKEN`

## Release Commands

```bash
# Preview what will happen (no changes made)
node scripts/release.js patch --dry-run
node scripts/release.js minor --dry-run
node scripts/release.js custom 0.3.0 --dry-run

# Patch release: 0.1.0 -> 0.1.1
pnpm release:patch

# Minor release: 0.1.0 -> 0.2.0
pnpm release:minor

# Major release: 0.1.0 -> 1.0.0
pnpm release:major

# Pre-release: 0.1.0 -> 0.1.1-alpha.0
pnpm release:alpha
pnpm release:beta

# Custom version
node scripts/release.js custom 0.3.0
node scripts/release.js custom 1.0.0-rc.1
```

## What the Release Script Does

1. **Bumps version** in all 12 `package.json` files (6 packages + 6 examples)
2. **Generates release notes** from git log with commit hashes and contributors
3. **Builds** all packages (`pnpm build`)
4. **Runs tests** (`pnpm test`)
5. **Commits**: `chore: release vX.Y.Z`
6. **Tags**: `vX.Y.Z` (annotated)
7. **Pushes** to remote with tags
8. **Publishes** all 6 `@forinda/kickjs-*` packages to npm

## Options

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview only, no changes |
| `--no-push` | Skip `git push` |
| `--no-publish` | Skip `npm publish` |
| `--tag <name>` | Prerelease tag (default: `alpha`) |
| `--from <ref>` | Generate notes from specific git ref |

## Step-by-Step: First Release

```bash
# 1. Make sure everything builds and tests pass
pnpm build
pnpm test

# 2. Preview the release
node scripts/release.js custom 0.3.0 --dry-run

# 3. Run the release (bumps, builds, tests, commits, tags, pushes, publishes)
node scripts/release.js custom 0.3.0

# 4. Create GitHub Release with the generated notes
gh release create v0.3.0 --title "v0.3.0" --notes-file RELEASE_NOTES_v0.3.0.md
```

## Step-by-Step: Subsequent Releases

```bash
# After merging PRs to main:
pnpm release:patch    # bug fixes
pnpm release:minor    # new features
pnpm release:major    # breaking changes
```

## CI Auto-Publish

The GitHub Actions release workflow auto-publishes when:
- A `v*` tag is pushed (triggered by the release script)
- A GitHub Release is published manually
- Manual dispatch with `publish: true`

The CI runs `pnpm -r publish --access public --no-git-checks` using the `NPM_TOKEN` secret.

## Versioning Strategy

All packages use **lockstep versioning** — every package shares the same version number. A change to any package bumps all of them.

| Version | Meaning |
|---------|---------|
| `0.x.y` | Pre-1.0: breaking changes on minor |
| `1.0.0+` | Semver strictly followed |
| `x.y.z-alpha.n` | Alpha pre-release |
| `x.y.z-beta.n` | Beta pre-release |
| `x.y.z-rc.n` | Release candidate |

## Published Packages

| Package | Description |
|---------|-------------|
| `@forinda/kickjs-core` | DI container, decorators, module system, logger |
| `@forinda/kickjs-http` | Express 5 app, middleware, query parsing |
| `@forinda/kickjs-config` | Zod env validation, ConfigService |
| `@forinda/kickjs-swagger` | OpenAPI spec, Swagger UI, ReDoc |
| `@forinda/kickjs-cli` | CLI binary, generators, custom commands |
| `@forinda/kickjs-testing` | Test utilities |

Examples are **not published** — they exist for reference only.

## Troubleshooting

**"Working directory not clean"** — Commit or stash changes first.

**npm 403/401** — Check your npm token: `npm whoami`

**"Package already published"** — You can't republish the same version. Bump to the next version.

**CI publish fails** — Check that `NPM_TOKEN` secret is set in GitHub repo settings.
