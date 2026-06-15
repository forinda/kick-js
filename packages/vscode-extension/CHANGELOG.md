# kickjs-devtools

## 5.3.0

### Minor Changes

- Security + v6 feature update for the VS Code extension:
  - **Token moved to SecretStorage.** The devtools auth token is no longer stored in the plaintext `kickjs.token` setting (which could be committed to `.vscode/settings.json`). It now lives in VS Code SecretStorage; an existing setting value is migrated once and the plaintext copy cleared. `KickJS: Set/Clear DevTools Token…` write to SecretStorage.
  - **Dashboard webview now sends the token.** The webview's `fetch`es include the `x-devtools-token` header, so the dashboard works against token-protected servers (previously it showed "Unavailable").
  - **Active runtime engine** (`express` / `fastify` / `h3`) is surfaced in the Health tree and the dashboard health card (KickJS v6 `/health.runtime`).
  - **New commands:** `KickJS: Doctor` (`kick doctor`), and `KickJS: DB Migrate / Status / Generate / Rollback` (`kick db …`).
  - **`Add Package…`** now offers `db`, `pg`, `sqlite`, `mysql`, `upload`, and `ai`; the deprecated `auth` / `drizzle` / `prisma` entries were removed.
  - Marketplace: `fastify` / `h3` / `database` keywords, `Visualization` category (was the misleading `Debuggers`), `bugs` / `homepage` fields.

## 5.2.1

### Patch Changes

- [#254](https://github.com/forinda/kick-js/pull/254) [`d4bc212`](https://github.com/forinda/kick-js/commit/d4bc21292dedbb20ee1a952a43422a09afaf35fb) Thanks [@forinda](https://github.com/forinda)! - docs: README sweep — drop v4 references, switch examples to defineModule + factory shape, fix dead links

  Documentation-only patch bump so the updated READMEs ship to the npm-displayed package pages (npm always includes README.md in the tarball regardless of `files` field). No code or wire-format changes; safe to consume without changes.

  **`@forinda/kickjs`** — full rewrite of the README's getting-started. Was 60 lines using a `class implements AppModule` example with a deprecated `buildRoutes` import. Now walks through service → controller → module → registry → bootstrap in canonical v5 factory shape, with Zod validation, typed `Ctx<KickRoutes…>`, project-layout overview, and pointers to every relevant guide page.

  **`@forinda/kickjs-cli`** — add `bun` to the `--pm` flag list (the CLI's `kick new` prompt supports bun; the README was missing it).

  **`@forinda/kickjs-vite`** — fix dead doc link (`guide/vite-plugin` → `guide/hmr`; no `vite-plugin.md` exists, the HMR guide covers the plugin surface).

  **`@forinda/kickjs-auth`** — replace `kick add auth` install with `pnpm add @forinda/kickjs-auth`. The package was removed from the `kick add` registry; existing adopters who still depend on it install manually now, and the README points at the BYO Auth recipe for the canonical path forward.

  **`@forinda/kickjs-queue`** — list provider variants in the install section (`kick add queue:bullmq | rabbitmq | kafka | redis-pubsub`). README previously only mentioned BullMQ even though three other providers ship in the package.

  **`@forinda/kickjs-lint`** — scrub the stale v3 → v4 migration link suffix; point at the current DI Tokens guide instead.

  **`kickjs-devtools` (VS Code extension)** — disambiguate the naming collision with `@forinda/kickjs-devtools` (the runtime adapter that serves `/_debug/*`). Adds an explicit "VS Code editor extension, not the runtime adapter" callout, and recommends setting `secret: env.DEVTOOLS_SECRET` on the adapter for production gating.

  Root repo `README.md` is also rewritten (drop v4.2 banner, remove "Deprecated — going private in v5" table for packages already gone, switch Hello World to factory patterns, drop `kick g resolver` and `kick add auth` references, update `kick g agents` description to `.agents/` subfolder layout) — but that file isn't published, so it's a free-rider on this changeset.
