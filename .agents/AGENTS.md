# AGENTS.md — AI Agent Guide for KickJS

This guide helps AI agents (Claude, Copilot, etc.) work effectively on the KickJS codebase.

## Engine & package layout (read first — avoids the two most common mistakes)

- **KickJS is engine-pluggable, not Express-only.** It runs on **Express (default), Fastify, or h3** behind one `HttpRuntime` seam (`bootstrap({ runtime })`). Controllers, modules, DI, and context decorators are engine-neutral — write to `ctx` (`ctx.json`/`ctx.body`/`ctx.params`/`ctx.sse`), not raw Express APIs. The runtimes (incl. the h3 v2 web-standard entries `./h3-web` and `./web` for edge/Bun/Deno) + cross-engine file uploads ship in the **stable** release.
- **The framework lives in `packages/kickjs`** (`@forinda/kickjs`) — DI core under `src/core/`, HTTP layer under `src/http/`, runtimes under `src/http/runtimes/{express,fastify,h3}.ts`. There is no separate `packages/core`, `packages/http`, or `packages/config`.

## Before You Start

1. Read `CLAUDE.md` for project conventions and commands
2. Run `pnpm build` to verify the project compiles
3. Run `pnpm test` to verify tests pass

## Where to Find Things

### Source Code

| What                 | Where                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| DI container         | `packages/kickjs/src/core/container.ts`                                    |
| All decorators       | `packages/kickjs/src/core/decorators.ts`                                   |
| Module system        | `packages/kickjs/src/core/app-module.ts`                                   |
| Adapter interface    | `packages/kickjs/src/core/adapter.ts`                                      |
| Error classes        | `packages/kickjs/src/core/errors.ts`                                       |
| Logger               | `packages/kickjs/src/core/logger.ts`                                       |
| Application wrapper  | `packages/kickjs/src/http/application.ts`                                  |
| Bootstrap function   | `packages/kickjs/src/http/bootstrap.ts`                                    |
| RequestContext       | `packages/kickjs/src/http/context.ts`                                      |
| HTTP runtime seam    | `packages/kickjs/src/http/runtime.ts` + `runtimes/{express,fastify,h3}.ts` |
| Router builder       | `packages/kickjs/src/http/router-builder.ts`                               |
| Middleware           | `packages/kickjs/src/http/middleware/*.ts`                                 |
| Query parsing        | `packages/kickjs/src/http/query/`                                          |
| Config/env           | `packages/kickjs/src/config/`                                              |
| CLI commands         | `packages/cli/src/commands/`                                               |
| Code generators      | `packages/cli/src/generators/`                                             |
| Generator patterns   | `packages/cli/src/generators/patterns/{rest,minimal}.ts`                   |
| Template functions   | `packages/cli/src/generators/templates/`                                   |
| TemplateContext type | `packages/cli/src/generators/templates/types.ts`                           |
| Scaffold layers      | `packages/cli/templates/<layer>/files/` + `src/scaffold/overlay.ts`        |
| ModuleConfig type    | `packages/cli/src/config.ts`                                               |
| Swagger decorators   | `packages/swagger/src/decorators.ts`                                       |
| OpenAPI builder      | `packages/swagger/src/openapi-builder.ts`                                  |
| WebSocket adapter    | `packages/ws/src/ws-adapter.ts`                                            |
| WebSocket decorators | `packages/ws/src/decorators.ts`                                            |
| WebSocket context    | `packages/ws/src/ws-context.ts`                                            |
| Room manager         | `packages/ws/src/room-manager.ts`                                          |
| gRPC/Connect adapter | `packages/grpc/src/grpc-adapter.ts`                                        |
| gRPC route builder   | `packages/grpc/src/router.ts`                                              |
| gRPC context         | `packages/grpc/src/grpc-context.ts`                                        |

### Configuration

| What                      | Where                               |
| ------------------------- | ----------------------------------- |
| TypeScript base config    | `tsconfig.base.json`                |
| Turbo build orchestration | `turbo.json`                        |
| oxfmt / oxlint config     | `.oxfmtrc.json`, `.oxlintrc.json`   |
| Vitest config             | `vitest.config.ts`                  |
| Pre-commit hook           | `lefthook.yml`                      |
| VitePress config          | `docs/.vitepress/config.mts`        |
| CI pipeline               | `.github/workflows/ci.yml`          |
| Release pipeline          | `.github/workflows/release.yml`     |
| Docs deploy               | `.github/workflows/deploy-docs.yml` |

### Reference Implementations

When adding new features, use these as templates:

| Task            | Reference File                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| New middleware  | `packages/kickjs/src/http/middleware/csrf.ts`                                 |
| New adapter     | `packages/swagger/src/swagger.adapter.ts`                                     |
| New package     | `packages/schema/` (tsdown-based structure — the repo standard)               |
| New example app | [kickjs-examples-archive](https://github.com/forinda/kickjs-examples-archive) |
| New test file   | `packages/kickjs/__tests__/` (per-package) or root `__tests__/` (integration) |
| Package exports | `packages/kickjs/package.json` (exports map — verify against tsdown output)   |
| Build config    | `packages/kickjs/tsdown.config.ts` (multi-entry)                              |

## Checklist: Adding a Feature

### New Middleware

- [ ] Create `packages/kickjs/src/http/middleware/<name>.ts`
- [ ] Export factory function: `export function name(options = {}) { return (req, res, next) => ... }`
- [ ] Add to `packages/kickjs/tsdown.config.ts` `entry` object
- [ ] Add to `packages/kickjs/package.json` exports map
- [ ] Add re-export to `packages/kickjs/src/http/index.ts` (+ `src/index.ts` if public — the root index is selective)
- [ ] Add docs page at `docs/guide/<name>.md`
- [ ] Add to sidebar in `docs/.vitepress/config.mts`
- [ ] Run `pnpm build && pnpm test`

### New Package

- [ ] Create `packages/<name>/` directory
- [ ] Add `package.json` (name: `@forinda/kickjs-<name>`, version: `0.0.0` — first changeset sets the published version)
- [ ] Add `tsconfig.json` (extends `../../tsconfig.base.json`)
- [ ] Add `tsdown.config.ts` (`format: ['esm']`, `dts: true`, runtime deps in `external`) and `vitest.config.ts` — copy `packages/schema/`
- [ ] Check the `package.json` exports map matches what tsdown emits
- [ ] Add `src/index.ts` (barrel exports)
- [ ] Add `README.md` and `LICENSE`
- [ ] Run `pnpm install` to link workspace
- [ ] Register the package as an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/) (Repository: `forinda/kick-js` · Workflow: `.github/workflows/release.yml`) so the release workflow can publish via OIDC
- [ ] Add docs page at `docs/api/<name>.md`
- [ ] Run `pnpm build && pnpm test`

### New Example App

- [ ] Example apps live in [kickjs-examples-archive](https://github.com/forinda/kickjs-examples-archive), not this repo — there is no in-repo `examples/`
- [ ] Scaffold there with the built CLI (see below)
- [ ] List it in `docs/examples/index.md`

### Documentation Changes

- [ ] Edit markdown files in `docs/`
- [ ] Use **relative links** for internal references (e.g., `./getting-started` not `/guide/getting-started`)
- [ ] Update sidebar in `docs/.vitepress/config.mts` if adding new pages
- [ ] Update versioned docs in `docs/versions/` if modifying existing pages
- [ ] Run `pnpm docs:build` to verify

## Mandatory: Design Notes Stay Private

Design docs, specs, plans, and experiment write-ups are working material, not public documentation.

- **Where they live:** `.ignored/designs/` (git-ignored). This covers `*-design.md`, `spec-*.md`, `*-plan.md`, milestone plans, and optimisation/benchmark experiments. Never commit them at the repo root, under `docs/`, or inside a package.
- **No references from tracked files.** Source, tests, published docs, changesets, and PR/issue bodies must not point at them. That means no `Spec: docs/…md`, `see x-design.md`, and no bare section or phase IDs from a design doc (`§3.1`, `R2`, `M4.B`, "phase 3 of …"). State the behaviour in the comment itself, or link a published page on kickjs.app.
- **If users need it, publish it.** When a published guide needs something from a design doc (an example, a per-dialect table, a caveat), write that content into the guide, not a link to the design doc.
- **Check before committing:** `git grep -nE '(-design|spec-[a-z-]+|-plan)\.md' -- ':!*CHANGELOG.md'` should find nothing new.

## Mandatory: Keep Docs in Sync

**Every feature addition, update, or API change MUST include documentation updates.** This prevents docs from going stale.

- New middleware → add a guide page at `docs/guide/<name>.md` + sidebar entry
- New package → add an API page at `docs/api/<name>.md` + sidebar entry
- New example → list it in `docs/examples/index.md`
- Changed API/options → update the relevant docs page
- Completed roadmap item → set its `Status:` to `shipped` in `docs/guide/roadmap.md`

Do NOT consider a feature complete until its docs are written and the sidebar is updated in `docs/.vitepress/config.mts`.

## Mandatory: Use the CLI for Examples

**Example apps MUST be scaffolded using the KickJS CLI** (`kick new` + `kick g module`). This ensures the CLI stays functional and tested against the latest framework changes. If a scaffold fails, that's a CLI bug — fix it before creating the example manually.

```bash
# Build the CLI first (in this repo)
pnpm build

# Scaffold inside your kickjs-examples-archive clone
node <path-to-kick-js>/packages/cli/bin.js new upload-api --yes --no-install --force

# Or specify each flag for a non-default scaffold
node <path-to-kick-js>/packages/cli/bin.js new upload-api \
  --template rest --pm pnpm --repo postgres --no-git --no-install --force

# Generate modules inside the example
cd upload-api
node <path-to-kick-js>/packages/cli/bin.js g module upload
```

`--yes` (alias `--non-interactive`, short `-y`) bypasses every prompt. Without it, missing flags trigger interactive selection.

Available flags for `new`: `--template rest|minimal|fullstack`, `--pm pnpm|npm|yarn|bun`, `--repo inmemory|<any-name>`, `--packages swagger,ws,...`, `--no-git`, `--no-install`, `--force`, `-y / --yes / --non-interactive`.

After scaffolding, customize the generated code for the example's purpose.

## CLI Generator Architecture

Template functions accept `TemplateContext` (option object, not positional args):

```ts
interface TemplateContext {
  pascal: string
  kebab: string
  plural?: string
  pluralPascal?: string
  repoPrefix?: string
  dtoPrefix?: string
  repoType?: string
}
```

There are no ORM-specific templates. A repository shaped to Prisma or Drizzle
is that library's interface, not KickJS's, so `--repo <name>` scaffolds a
generic custom-repository stub the project owns.

Pattern generators are in `generators/patterns/`:

- `rest.ts`, `minimal.ts` — each exports a `generate*Files(ctx: ModuleContext)` function

### Key Config: kick.config.ts

```ts
export default defineConfig({
  pattern: 'rest',
  modules: {
    dir: 'src/modules',
    repo: { name: 'postgres' }, // 'inmemory' (built-in) | { name } → custom stub
    pluralize: true,
  },
})
```

Top-level `modulesDir`, `defaultRepo`, `pluralize`, `schemaDir` are deprecated — use `modules` block.

## Common Pitfalls

1. **Don't use absolute links in docs** — breaks versioning and i18n
2. **Don't bump package versions manually** — write a changeset (`pnpm changeset`); the release workflow handles the bump + publish via npm trusted publishers. See `RELEASE.md`.
3. **Don't forget `pnpm format`** — pre-commit hook will reject unformatted code
4. **Don't add to `.gitignore` without `**/`prefix** — patterns like`.vitepress/` only match at root
5. **Don't manually publish packages** — the changesets release workflow (see `RELEASE.md`) is the only sanctioned publish path. `pnpm -r publish` and `pnpm --filter='./packages/*' publish` both bypass version PRs + npm trusted-publisher OIDC and will fail (or worse, succeed without provenance).
6. **Don't skip `Container.reset()` in tests** — decorators register against the global container
7. **Don't import from `dist/`** — use workspace package names (`@forinda/kickjs`)

## Testing Guidelines

- All tests are in `tests/` at repo root
- Use vitest imports: `import { describe, it, expect, beforeEach } from 'vitest'`
- Reset DI container: `beforeEach(() => Container.reset())`
- Build must pass before tests run (wireit dependency graph)
- Run specific test: `pnpm vitest run tests/<file>.test.ts`

## Git Workflow

Use feature branches and PRs — never commit directly to `main`:

```bash
# 1. Create a feature branch
git checkout -b feat/route-table-on-startup

# 2. Make changes, commit with conventional commits
git add packages/kickjs/
git commit -m "feat: print route table on application startup (#31)"

# 3. Push and create PR (rich bodies go through a temp file — see below)
git push -u origin feat/route-table-on-startup
gh pr create --title "feat: print route table on startup" --body-file /tmp/pr-body.md

# 4. After review, merge via GitHub (squash or merge commit)
```

### PR / issue bodies with markdown — always via a temp file

Anything richer than a single-line description (code fences, lists, tables, backticks, `$`, multi-paragraph) goes through a temp file. **Never** inline a multi-line body in `gh pr create --body "$(cat <<'EOF' ... EOF)"` or `gh pr edit --body "..."` — the shell escapes backticks and dollar signs, fenced code blocks lose their language hint, and the body lands on GitHub with literal `\`` everywhere.

```bash
# Right — write the body to a file, then pass it:
cat > /tmp/pr-body.md <<'EOF'
## Why
…full markdown, no escape gymnastics…
EOF

gh pr create --base main --title "…" --body-file /tmp/pr-body.md

# Edits to existing PRs take --body-file too:
gh pr edit 123 --body-file /tmp/pr-body.md

# If `gh pr edit` exits non-zero (often: projects-classic deprecation),
# fall back to the API:
gh api -X PATCH /repos/<owner>/<repo>/pulls/123 -F body=@/tmp/pr-body.md
```

Same rule for `gh issue create`, `gh release create`, comment posts (`gh pr comment 123 --body-file …`), and changeset bodies committed to disk.

### Branch naming

| Prefix   | Use                   |
| -------- | --------------------- |
| `feat/`  | New features          |
| `fix/`   | Bug fixes             |
| `docs/`  | Documentation only    |
| `chore/` | Maintenance, deps, CI |
| `test/`  | Test additions        |

### Commit convention

Follow [Conventional Commits](https://www.conventionalcommits.org/). Commit types categorize changes; the **changeset** you add in the same PR (`pnpm changeset`) chooses the actual semver bump per affected package:

- `feat:` — usually a minor bump in the changeset
- `fix:` — usually a patch bump in the changeset
- `docs:`, `chore:`, `test:`, `ci:` — usually no changeset (skip the prompt)

Reference issue numbers: `feat: add helmet middleware (#21)`

## Build Verification

After any code change, verify with:

```bash
pnpm build          # All packages compile
pnpm test           # All tests pass
pnpm format:check   # Code style OK
pnpm docs:build     # Docs compile (if docs changed)
```
