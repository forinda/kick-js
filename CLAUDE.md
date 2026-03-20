# CLAUDE.md — KickJS Development Guide

## Project Overview

KickJS is a decorator-driven Node.js framework built on Express 5 and TypeScript. Monorepo managed with pnpm workspaces and Turbo.

## Quick Commands

```bash
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm format             # Fix formatting
pnpm format:check       # Check formatting
pnpm docs:dev           # Dev docs server
pnpm docs:build         # Build docs
pnpm release:dry        # Dry run release
```

## Repository Structure

```
packages/               # Published @forinda/kickjs-* packages
  core/                 # DI container, decorators, module system, logger
  http/                 # Express 5, routing, middleware, query parsing
  config/               # Zod-based env validation, typed config
  cli/                  # Project scaffolding, DDD generators
  swagger/              # OpenAPI spec generation from decorators
  testing/              # Test utilities, TestModule builder
  prisma/               # Prisma adapter, DI integration, query building
examples/               # Non-published example apps (basic, auth, validated, full, swagger, joi)
scripts/                # release.js (versioning), translate-docs.js (i18n)
tests/                  # Root integration tests (vitest)
docs/                   # VitePress documentation site
```

## Package Manager & Build

- **pnpm 10.12.1** — always use `pnpm`, never npm/yarn
- **Turbo** — orchestrates builds with dependency-aware caching
- **tsup** — builds each package (ESM, DTS, sourcemaps, node20 target)
- **Vitest** — test runner with SWC for decorator support

## Code Style

- **Prettier** — no semicolons, single quotes, trailing commas, 100 char width
- **No ESLint** — relies on TypeScript strict mode + Prettier
- **Pre-commit hook** — runs `build → test → format:check` via husky
- Format before committing: `pnpm format`

## Key Patterns

### Adding Middleware (to `packages/http`)

1. Create `packages/http/src/middleware/<name>.ts` — export a factory function returning Express middleware
2. Add entry to `packages/http/tsup.config.ts`
3. Add export map entry to `packages/http/package.json`
4. Add re-export to `packages/http/src/index.ts`
5. Reference: `packages/http/src/middleware/csrf.ts`

### Adding a Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `tsup.config.ts`
2. Name it `@forinda/kickjs-<name>`, version `0.3.2` (lockstep)
3. Use `workspace:*` for internal deps
4. Add `homepage: "https://forinda.github.io/kick-js/"`
5. Reference: `packages/swagger/` or `packages/prisma/`

### Adding an Adapter

Implement `AppAdapter` from `@forinda/kickjs-core/adapter`:
- `name: string`
- `beforeMount?(app, container)`, `beforeStart?(app, container)`, `afterStart?(app, container)`
- `shutdown?(): Promise<void>`
- `middleware?(): AdapterMiddleware[]`

### Decorators

```ts
@Controller('/path')       // Route prefix
@Get('/'), @Post('/'), @Put('/'), @Delete('/'), @Patch('/')  // HTTP methods
@Service()                 // DI-registered singleton
@Autowired()               // Property injection
@Inject('token')           // Token-based injection
@Value('ENV_VAR')          // Config value injection
@Middleware(fn)            // Attach middleware
```

### RequestContext

Every controller method receives `ctx: RequestContext` with:
- `ctx.body`, `ctx.params`, `ctx.query`, `ctx.headers`
- `ctx.requestId`, `ctx.session`, `ctx.file`, `ctx.files`
- `ctx.qs(fieldConfig)` — parsed query with filters/sort/pagination
- `ctx.json(data)`, `ctx.created(data)`, `ctx.noContent()`, `ctx.notFound()`

## Linking the CLI Locally

To make `kick` available globally from your local build (like `ng` for Angular):

```bash
pnpm build
cd packages/cli && pnpm link --global
```

Now `kick` uses your latest local code. After changes, just `pnpm build` — no re-link needed.

## Testing

- Tests live in `tests/` at root
- Use `Container.reset()` in `beforeEach` to isolate DI state
- Import from vitest: `import { describe, it, expect, beforeEach } from 'vitest'`
- Run: `pnpm test`

## Releasing

All packages use **lockstep versioning**. Never bump individually.

```bash
pnpm release:patch                  # 0.3.2 → 0.3.3
pnpm release:minor                  # 0.3.2 → 0.4.0
pnpm release:patch:gh               # With GitHub release
pnpm release:dry                    # Preview only
```

The release script (`scripts/release.js`) bumps all 12 package.json files, generates release notes, commits, tags, pushes, and publishes.

## Documentation

- VitePress site at `docs/`
- Deployed to GitHub Pages via `.github/workflows/deploy-docs.yml`
- Config: `docs/.vitepress/config.mts`
- Versioning: `vitepress-versioning-plugin` — snapshot docs into `docs/versions/<version>/`
- i18n: run `pnpm docs:translate` (Google Translate API)

## CI/CD

- **ci.yml** — build, typecheck, test, format on push to main/dev and PRs
- **deploy-docs.yml** — build and deploy VitePress on push to main
- **release.yml** — verify and publish on version tags

## Commit Conventions

```
feat: description      # New feature
fix: description       # Bug fix
docs: description      # Documentation only
chore: description     # Maintenance
ci: description        # CI/CD changes
test: description      # Test changes
```

## Important Notes

- Decorators fire at class definition time — tests need `Container.reset()` + re-registration
- `pnpm --filter='./packages/*' publish` — only publishes framework packages, not examples
- All internal links in docs must be **relative** (for versioning/i18n support)
- The `kick` CLI binary comes from `packages/cli/src/cli.ts`
