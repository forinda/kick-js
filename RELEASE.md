# Release process

KickJS uses **[Changesets](https://github.com/changesets/changesets)** for per-package versioning + changelogs and **[npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)** (OIDC, no `NPM_TOKEN`) for publish.

Versions are **independent per package**. `@forinda/kickjs@5.3.0` may pair with `@forinda/kickjs-cli@5.2.1` — adopters track per-package semver, the framework no longer bumps every package together.

## Daily flow — adding a changeset to your PR

When your PR changes a published package, write a changeset describing the change:

```bash
pnpm changeset
```

The CLI prompts:

1. Which packages changed? (multi-select)
2. What kind of bump per package? (`major` / `minor` / `patch`)
3. A summary that becomes the changelog entry.

It writes `.changeset/<random-name>.md`. Commit it alongside your code changes. The PR review treats this file as the source of truth for the next version bump.

```bash
pnpm changeset:status   # show pending changesets and projected bumps
```

## Automated release flow

`.github/workflows/release.yml` runs on every push to `main`:

1. **Pending changesets exist** → the workflow opens / updates a "Version Packages" PR. The PR contains:
   - Bumped `package.json` versions for every affected package
   - Per-package `CHANGELOG.md` entries auto-generated from the changeset bodies (PR / commit links via `@changesets/changelog-github`)
   - Removed changeset files (consumed)
2. **No pending changesets, but the previous PR just merged** → the workflow runs `pnpm changeset:publish`:
   - Publishes the bumped packages to npm
   - Creates GitHub releases per published package
   - Tags every release in git

You never run `npm publish` manually. Merging the auto-PR is the trigger.

## npm trusted publishers — one-time setup per package

Each published package needs a trusted-publisher rule on npm so the workflow can publish without a token. Once per package:

1. Visit `https://www.npmjs.com/package/<name>/access` (signed in as the maintainer).
2. **Trusted publishers** → **Add trusted publisher** → GitHub Actions.
3. Repository: `forinda/kick-js` · Workflow path: `.github/workflows/release.yml` · Environment: _(blank)_.

Once added, npm validates the OIDC token GitHub Actions issues during the workflow run. The token is short-lived and tied to this exact workflow file — leaked secrets aren't reusable.

`NPM_CONFIG_PROVENANCE=true` is set in the workflow so every published tarball carries a signed provenance statement linking the artefact to the commit + workflow run that produced it. Adopters see the "Verified" badge on the package page.

## Versioned docs snapshots

The VitePress site shows a version switcher backed by `docs/versions/<version>/`. Snapshots are **decoupled from package releases** — most patches ship zero doc-shape changes, and bundling a full docs copy into every "Version Packages" PR drowns the actual review signal.

Cut a snapshot when prose has materially changed and you want to pin "the docs as of vX.Y":

```bash
pnpm docs:snapshot                          # use current @forinda/kickjs version
pnpm docs:snapshot -- --version 5.3.0       # explicit
pnpm docs:snapshot -- --force               # overwrite an existing snapshot
pnpm format
git checkout -b docs/snapshot-vX.Y
git add docs/versions/<version>
git commit -m "docs: snapshot vX.Y"
gh pr create --base main --title "docs: snapshot vX.Y"
```

The snapshot copies `docs/{guide,api,examples}/` plus `docs/{changelog,roadmap,index}.md` — only content pages, never `.vitepress/`, `versions/`, or `public/`. The directory name is conventionally the `@forinda/kickjs` core version (the version adopters cite), but `--version` accepts any string for special cuts (`5.3.0-rewrite`, etc).

This stays out of `pnpm changeset:version`. Release PRs only touch `package.json`, changelogs, and the lockfile — review takes 30 seconds again.

## Pre-releases (alpha / beta / rc)

Changesets has a "pre" mode that turns subsequent bumps into pre-release versions until you explicitly exit:

```bash
# Enter pre-release mode (e.g., before a 6.0.0 release)
pnpm release:enter:alpha
# … add changesets and merge as usual; bumps become 6.0.0-alpha.0, 6.0.0-alpha.1, …

# When ready for stable
pnpm release:exit:pre
# Next merge bumps to 6.0.0
```

Pre-mode state is stored in `.changeset/pre.json`; commit it.

The npm dist-tag is derived automatically by changesets from the version string (`alpha` for `*-alpha.*`, `beta` for `*-beta.*`, etc).

## Manual escape hatch

If something goes sideways and you need to publish off-PR (e.g. patching a single package after the auto-PR was merged but `publish` failed):

```bash
# Locally, on main, after pulling the merged version commit:
pnpm install
pnpm build
pnpm changeset:tag       # writes git tags for unreleased versions
git push --tags
```

Then re-run the workflow via **Actions → Release → Run workflow**. The trusted-publisher OIDC still applies — no token to manage.

## VS Code extension

`packages/vscode-extension` (`forinda-kickjs-devtools` on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=forinda.forinda-kickjs-devtools), publisher `forinda`) is private to the workspace, so Changesets and the release workflow skip it. It's versioned and published by hand. The language server and its copy of `@forinda/kickjs-view` are bundled into it, so changes to `packages/view-language-server` or `packages/view` reach editors only with the next extension release.

1. **Changelog and version** — in a PR named `chore(vscode): release X.Y.Z`:
   - add `## X.Y.Z` at the top of `packages/vscode-extension/CHANGELOG.md`, written for users like the entries below it, covering the extension's own changes and what it now bundles;
   - set `"version"` in `packages/vscode-extension/package.json`.

   A new feature is a minor bump, a fix a patch. Commits since the last release: `git log --oneline <last release commit>.. -- packages/vscode-extension packages/view-language-server packages/view/src`.

2. **Package** — after the PR merges:

   ```bash
   git checkout main && git pull
   pnpm install
   pnpm build
   pnpm --filter forinda-kickjs-devtools package   # → packages/vscode-extension/forinda-kickjs-devtools-X.Y.Z.vsix
   ```

   `.vsix` files are git-ignored. To check what goes in: `cd packages/vscode-extension && npx vsce ls --no-dependencies`.

3. **Try it** — `code --install-extension packages/vscode-extension/forinda-kickjs-devtools-X.Y.Z.vsix`, reload the window, then open a `.kick` file (highlighting, diagnostics, a `kick-` snippet) and connect to a running app.

4. **Publish** — either:
   - from the CLI, with an Azure DevOps personal access token that has **Marketplace → Manage** scope for the `forinda` publisher:

     ```bash
     cd packages/vscode-extension
     npx vsce login forinda    # once per machine; asks for the token
     npx vsce publish --packagePath forinda-kickjs-devtools-X.Y.Z.vsix
     ```

   - or in the browser: [manage the publisher](https://marketplace.visualstudio.com/manage/publishers/forinda), open the extension's **⋯** menu → **Update**, and upload the `.vsix`.

   Publishing the packaged file (rather than `vsce publish` with no file) ships exactly what you tried in step 3. The Marketplace takes a few minutes to show the new version.

## Migrating from the old release script

The previous `scripts/release.js` (lockstep versioning) is removed. If you have a long-running branch with `pnpm release:patch` muscle memory, the new equivalent is:

```bash
pnpm changeset      # describe what you changed
git push            # CI handles version + publish via the auto-PR
```

There is no `pnpm release:patch` / `release:minor` / `release:major` anymore. Each changeset chooses its own bump per package, and the workflow handles the rest.
