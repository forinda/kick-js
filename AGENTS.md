# AGENTS.md — AI Agent Guide for KickJS

This guide helps AI agents (Claude, Copilot, etc.) work effectively on the KickJS codebase.

## Before You Start

1. Read `CLAUDE.md` for project conventions and commands
2. Run `pnpm build` to verify the project compiles
3. Run `pnpm test` to verify tests pass

## Where to Find Things

### Source Code

| What | Where |
|------|-------|
| DI container | `packages/core/src/container.ts` |
| All decorators | `packages/core/src/decorators.ts` |
| Module system | `packages/core/src/app-module.ts` |
| Adapter interface | `packages/core/src/adapter.ts` |
| Error classes | `packages/core/src/errors.ts` |
| Logger | `packages/core/src/logger.ts` |
| Express app wrapper | `packages/http/src/application.ts` |
| Bootstrap function | `packages/http/src/bootstrap.ts` |
| RequestContext | `packages/http/src/context.ts` |
| Router builder | `packages/http/src/router-builder.ts` |
| Middleware | `packages/http/src/middleware/*.ts` |
| Query parsing | `packages/http/src/query/` |
| Config/env | `packages/config/src/` |
| CLI commands | `packages/cli/src/commands/` |
| Code generators | `packages/cli/src/generators/` |
| Generator patterns | `packages/cli/src/generators/patterns/{rest,ddd,cqrs,minimal}.ts` |
| Template functions | `packages/cli/src/generators/templates/` |
| Drizzle templates | `packages/cli/src/generators/templates/drizzle/` |
| Prisma templates | `packages/cli/src/generators/templates/prisma/` |
| TemplateContext type | `packages/cli/src/generators/templates/types.ts` |
| ModuleConfig type | `packages/cli/src/config.ts` |
| PrismaModelDelegate | `packages/prisma/src/types.ts` |
| Swagger decorators | `packages/swagger/src/decorators.ts` |
| OpenAPI builder | `packages/swagger/src/openapi-builder.ts` |
| Prisma adapter | `packages/prisma/src/prisma.adapter.ts` |
| Prisma query adapter | `packages/prisma/src/query-adapter.ts` |
| WebSocket adapter | `packages/ws/src/ws-adapter.ts` |
| WebSocket decorators | `packages/ws/src/decorators.ts` |
| WebSocket context | `packages/ws/src/ws-context.ts` |
| Room manager | `packages/ws/src/room-manager.ts` |

### Configuration

| What | Where |
|------|-------|
| TypeScript base config | `tsconfig.base.json` |
| Wireit build orchestration | Per-package `wireit` config in `package.json` |
| Prettier config | `.prettierrc` |
| Vitest config | `vitest.config.ts` |
| Pre-commit hook | `.husky/pre-commit` |
| VitePress config | `docs/.vitepress/config.mts` |
| CI pipeline | `.github/workflows/ci.yml` |
| Release pipeline | `.github/workflows/release.yml` |
| Docs deploy | `.github/workflows/deploy-docs.yml` |

### Reference Implementations

When adding new features, use these as templates:

| Task | Reference File |
|------|---------------|
| New middleware | `packages/http/src/middleware/csrf.ts` |
| New adapter | `packages/swagger/src/swagger.adapter.ts` |
| New package | `packages/prisma/` (full package structure) |
| New example app | `examples/minimal-api/` (simple) or `examples/task-prisma-api/` (full) |
| New test file | `tests/container.test.ts` |
| Package exports | `packages/http/package.json` (exports map) |
| Vite build config | `packages/http/vite.config.ts` (multi-entry) |

## Checklist: Adding a Feature

### New Middleware

- [ ] Create `packages/http/src/middleware/<name>.ts`
- [ ] Export factory function: `export function name(options = {}) { return (req, res, next) => ... }`
- [ ] Add to `packages/http/vite.config.ts` `build.lib.entry` object
- [ ] Add to `packages/http/package.json` exports map
- [ ] Add re-export to `packages/http/src/index.ts`
- [ ] Add docs page at `docs/guide/<name>.md`
- [ ] Add to sidebar in `docs/.vitepress/config.mts`
- [ ] Run `pnpm build && pnpm test`

### New Package

- [ ] Create `packages/<name>/` directory
- [ ] Add `package.json` (name: `@forinda/kickjs-<name>`, version: lockstep)
- [ ] Add `tsconfig.json` (extends `../../tsconfig.base.json`)
- [ ] Add `vite.config.ts` (ESM lib mode, node20, `minify: 'esbuild'`, externals)
- [ ] Add `tsconfig.build.json` (extends tsconfig, `emitDeclarationOnly: true`)
- [ ] Add `src/index.ts` (barrel exports)
- [ ] Add `README.md` and `LICENSE`
- [ ] Run `pnpm install` to link workspace
- [ ] Add to `scripts/release.js` if it should be version-bumped
- [ ] Add docs page at `docs/api/<name>.md`
- [ ] Run `pnpm build && pnpm test`

### New Example App

- [ ] Scaffold with CLI: `cd examples && node ../packages/cli/bin.js new <name> --template ddd --pm pnpm --repo inmemory --no-git --no-install --force`
- [ ] Add `package.json` (private: true, version: lockstep, `workspace:*` deps)
- [ ] Add to `scripts/release.js` EXAMPLES array
- [ ] Add docs page at `docs/examples/<name>.md`
- [ ] Add to sidebar in `docs/.vitepress/config.mts`
- [ ] Reference examples: `minimal-api/` (simple), `task-prisma-api/` (full DDD)

### Documentation Changes

- [ ] Edit markdown files in `docs/`
- [ ] Use **relative links** for internal references (e.g., `./getting-started` not `/guide/getting-started`)
- [ ] Update sidebar in `docs/.vitepress/config.mts` if adding new pages
- [ ] Update versioned docs in `docs/versions/` if modifying existing pages
- [ ] Run `pnpm docs:build` to verify

## Mandatory: Keep Docs in Sync

**Every feature addition, update, or API change MUST include documentation updates.** This prevents docs from going stale.

- New middleware → add a guide page at `docs/guide/<name>.md` + sidebar entry
- New package → add an API page at `docs/api/<name>.md` + sidebar entry
- New example → add a page at `docs/examples/<name>.md` + sidebar entry
- Changed API/options → update the relevant docs page
- Completed roadmap item → check it off in `docs/roadmap.md`
- New feature → update `docs/roadmap.md` "Recently Completed" section

Do NOT consider a feature complete until its docs are written and the sidebar is updated in `docs/.vitepress/config.mts`.

## Mandatory: Use the CLI for Examples

**Example apps MUST be scaffolded using the KickJS CLI** (`kick new` + `kick g module`). This ensures the CLI stays functional and tested against the latest framework changes. If a scaffold fails, that's a CLI bug — fix it before creating the example manually.

```bash
# Build the CLI first
pnpm build

# Scaffold from examples/ directory — pass all flags to avoid interactive prompts
cd examples
node ../packages/cli/bin.js new upload-api \
  --template ddd --pm pnpm --repo inmemory --no-git --no-install --force

# Generate modules inside the example
cd upload-api
node ../../packages/cli/bin.js g module upload
```

Available flags for `new`: `--template rest|graphql|ddd|cqrs|minimal`, `--pm pnpm|npm|yarn`, `--repo prisma|drizzle|inmemory|custom`, `--no-git`, `--no-install`, `--force`.

After scaffolding, customize the generated code for the example's purpose.

## CLI Generator Architecture

Template functions accept `TemplateContext` (option object, not positional args):
```ts
interface TemplateContext {
  pascal: string; kebab: string; plural?: string; pluralPascal?: string
  repoPrefix?: string; dtoPrefix?: string; prismaClientPath?: string; repoType?: string
}
```

ORM-specific templates live in subfolders:
- `templates/drizzle/` — `generateDrizzleRepository`, `generateDrizzleConstants`
- `templates/prisma/` — `generatePrismaRepository` (uses `PrismaModelDelegate`)

Pattern generators are in `generators/patterns/`:
- `rest.ts`, `ddd.ts`, `cqrs.ts`, `minimal.ts` — each exports a `generate*Files(ctx: ModuleContext)` function

### Key Config: kick.config.ts

```ts
export default defineConfig({
  pattern: 'ddd',
  modules: {
    dir: 'src/modules',
    repo: 'prisma',                     // 'drizzle' | 'inmemory' | 'prisma' | { name: 'custom' }
    pluralize: true,
    prismaClientPath: '@/generated/prisma/client',  // Prisma 7
  },
})
```

Top-level `modulesDir`, `defaultRepo`, `pluralize`, `schemaDir` are deprecated — use `modules` block.

## Common Pitfalls

1. **Don't use absolute links in docs** — breaks versioning and i18n
2. **Don't bump package versions manually** — use `scripts/release.js` (lockstep)
3. **Don't forget `pnpm format`** — pre-commit hook will reject unformatted code
4. **Don't add to `.gitignore` without `**/` prefix** — patterns like `.vitepress/` only match at root
5. **Don't use `pnpm -r publish`** — use `pnpm --filter='./packages/*' publish` to skip examples
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
git add packages/http/
git commit -m "feat: print route table on application startup (#31)"

# 3. Push and create PR
git push -u origin feat/route-table-on-startup
gh pr create --title "feat: print route table on startup" --body "Closes #31"

# 4. After review, merge via GitHub (squash or merge commit)
```

### Branch naming

| Prefix | Use |
|--------|-----|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `chore/` | Maintenance, deps, CI |
| `test/` | Test additions |

### Commit convention

Follow [Conventional Commits](https://www.conventionalcommits.org/). Commit types categorize changes and guide the explicit version bump when running `node scripts/release.js <patch|minor|major>`:
- `feat:` — generally corresponds to a minor version bump
- `fix:` — generally corresponds to a patch version bump
- `docs:`, `chore:`, `test:`, `ci:` — usually no version bump

Reference issue numbers: `feat: add helmet middleware (#21)`

## Build Verification

After any code change, verify with:

```bash
pnpm build          # All packages compile
pnpm test           # All tests pass
pnpm format:check   # Code style OK
pnpm docs:build     # Docs compile (if docs changed)
```
