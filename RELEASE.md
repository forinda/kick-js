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
4. GitHub CLI (`gh`) installed and authenticated (for `--github-release`):
   ```bash
   gh auth login
   ```
5. GitHub `NPM_TOKEN` secret set (for CI-triggered publishes):
   - Repo Settings > Secrets > Actions > `NPM_TOKEN`

## Interactive Release (recommended)

Run the release script with no arguments for a guided experience:

```bash
node scripts/release.js
```

It will prompt you through:
1. **Release type** — patch, minor, major, prerelease, or custom
2. **Pre-release channel** — alpha, beta, rc (if prerelease)
3. **Options** — dry run, push, publish, GitHub release
4. **Confirmation** — review summary before executing

## Non-Interactive Commands

Pass arguments directly to skip prompts:

```bash
# Stable releases (from main)
pnpm release:patch                    # 1.4.0 → 1.4.1
pnpm release:minor                    # 1.4.0 → 1.5.0
pnpm release:major                    # 1.4.0 → 2.0.0

# With GitHub release
pnpm release:patch:gh
pnpm release:minor:gh

# Pre-releases (from main or dev)
pnpm release:alpha                    # 1.4.0 → 1.4.1-alpha.0
pnpm release:beta                     # 1.4.0 → 1.4.1-beta.0
node scripts/release.js prerelease --tag rc   # 1.4.0 → 1.4.1-rc.0

# Custom version
node scripts/release.js custom 2.0.0-rc.1

# Preview (no changes)
node scripts/release.js patch --dry-run
```

## Branching Model

| Branch | Purpose | npm tag | Release from |
|--------|---------|---------|--------------|
| `main` | Stable releases | `latest` | `pnpm release:patch/minor/major` |
| `dev` | Pre-releases | `alpha`/`beta`/`rc` | `pnpm release:alpha/beta` |

**Flow:**
1. Feature branches → PR → `dev` (experimental) or `main` (stable)
2. Pre-release from `dev`: `pnpm release:alpha`
3. When stable: PR `dev` → `main`, then `pnpm release:minor`

Users install:
```bash
pnpm add @forinda/kickjs-core                    # latest stable
pnpm add @forinda/kickjs-core@alpha              # latest alpha
pnpm add @forinda/kickjs-core@1.5.0-beta.0       # specific pre-release
```

## What the Release Script Does

1. **Bumps version** in all `package.json` files (19 packages + 10 examples)
2. **Generates release notes** from git log with commit hashes and contributors
3. **Builds** all packages (`pnpm build`)
4. **Runs tests** (`pnpm test`)
5. **Commits**: `chore: release vX.Y.Z`
6. **Tags**: `vX.Y.Z` (annotated)
7. **Pushes** to remote with tags
8. **Creates GitHub release** (if `--github-release`) via `gh` CLI with release notes
9. **Publishes** all `@forinda/kickjs-*` packages to npm with the correct dist-tag derived from the version (`latest` for stable, `alpha`/`beta`/`rc` for pre-releases) — both locally and in CI

## Options

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview only, no changes |
| `--no-push` | Skip `git push` |
| `--no-publish` | Skip `npm publish` |
| `--github-release` | Create GitHub release via `gh` CLI with release notes |
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

# 4. Or run with --github-release to auto-create the GitHub release
node scripts/release.js custom 0.3.0 --github-release
```

## Step-by-Step: Subsequent Releases

```bash
# After merging PRs to main:
pnpm release:patch       # bug fixes (manual GH release)
pnpm release:minor       # new features (manual GH release)
pnpm release:major       # breaking changes (manual GH release)

# With automatic GitHub release creation:
pnpm release:patch:gh    # bug fixes + GH release
pnpm release:minor:gh    # new features + GH release
pnpm release:major:gh    # breaking changes + GH release
```

## CI Auto-Publish

The GitHub Actions release workflow auto-publishes when:
- A `v*` tag is pushed (triggered by the release script)
- A GitHub Release targeting `main` is published manually
- Manual dispatch with `publish: true`

Note: manual GitHub Releases targeting `dev` do not auto-publish — the workflow is gated on `target_commitish == 'main'`. Pre-releases from `dev` should be triggered via tags (`v*-alpha.*`, `v*-beta.*`).

The CI auto-detects the npm dist-tag from the version:
- `1.5.0` → publishes as `latest`
- `1.5.0-alpha.0` → publishes as `alpha`
- `1.5.0-beta.0` → publishes as `beta`
- `1.5.0-rc.0` → publishes as `rc`

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

All 19 `@forinda/kickjs-*` packages are published with lockstep versioning. Key packages:

| Package | Description |
|---------|-------------|
| `@forinda/kickjs-core` | DI container, decorators, module system, logger |
| `@forinda/kickjs-http` | Express 5 app, middleware (helmet, cors, csrf, upload, rate-limit), query parsing |
| `@forinda/kickjs-config` | Zod env validation, ConfigService |
| `@forinda/kickjs-swagger` | OpenAPI spec, Swagger UI, ReDoc |
| `@forinda/kickjs-cli` | CLI binary, generators, custom commands |
| `@forinda/kickjs-testing` | Test utilities (createTestApp, createTestModule) |

Plus: auth, cron, devtools, drizzle, graphql, mailer, multi-tenant, notifications, otel, prisma, queue, ws, vscode-extension

Examples are **not published** — they exist for reference only.

## Troubleshooting

**"Working directory not clean"** — Commit or stash changes first.

**npm 403/401** — Check your npm token: `npm whoami`

**"Package already published"** — You can't republish the same version. Bump to the next version.

**CI publish fails** — Check that `NPM_TOKEN` secret is set in GitHub repo settings.
