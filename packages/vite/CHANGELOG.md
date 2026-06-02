# @forinda/kickjs-vite

## 6.0.1

### Patch Changes

- [#321](https://github.com/forinda/kick-js/pull/321) [`5dc5a99`](https://github.com/forinda/kick-js/commit/5dc5a991df7c92dd7c369f6f87a3b005ba3dea13) Thanks [@forinda](https://github.com/forinda)! - Fix two `kick dev` (Vite) lifecycle gaps — neither was Windows-specific, though Windows made the shutdown one worse.
  - **App now bootstraps at startup, not on first request.** The dev-server plugin evaluated the app lazily via `ssrLoadModule` inside the request middleware, so `bootstrap()`, adapter `afterStart`, and your startup logs didn't run until the first HTTP request hit. The plugin now warms the module once the HTTP server is listening, so `kick dev` behaves like `node`/`tsx` — logs + adapters + the server come up immediately.
  - **Graceful shutdown now runs on Ctrl+C in dev.** The app deliberately suppresses its own SIGINT/SIGTERM handlers in dev (Vite owns the lifecycle), and the CLI dev server only closed Vite — so `adapter.shutdown()`, request draining, and shutdown logs never ran. `Application.start()` now exposes its `shutdown()` on `globalThis` in dev, and `kick dev` awaits it before tearing down Vite. Also wires `SIGBREAK` (Windows Ctrl+Break) since Windows never raises `SIGTERM`.

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0

## 5.3.2

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.3.1

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

## 5.3.0

### Minor Changes

- [#178](https://github.com/forinda/kick-js/pull/178) [`468773e`](https://github.com/forinda/kick-js/commit/468773e691f09036661fa7167c32c9714e38f7a3) Thanks [@forinda](https://github.com/forinda)! - `@forinda/kickjs-vite` now ships a Babel-based devtools strip alongside the existing `__KICKJS_DEVTOOLS__` flag plugin. On `vite build`, the new `kickjs:devtools-strip` plugin walks each module and removes:
  - `import ... from '@forinda/kickjs-devtools-kit'` declarations (and any sub-path: `/bus`, `/runtime`, etc.) — named, default, namespace, and side-effect forms.
  - Top-level `ExpressionStatement`s whose root identifier is a binding stripped above. Catches `defineDevtoolsRenderTab(...)`, `defineDevtoolsTab(...)`, and namespace member-calls like `devtools.defineDevtoolsRenderTab(...)`.
  - Side-effect imports whose path ends in `/devtools-events` — adapter-package augmentation modules.

  In dev (`kick dev`), the plugin is a no-op so the devtools UI keeps working. In prod, adopters who previously had to wrap every devtools call in `if (__KICKJS_DEVTOOLS__) { ... }` can now drop the wrapper for top-level cases and let the strip handle it. Adopters whose devtools calls live inside function bodies still need the flag (the strip leaves non-top-level references alone — a deliberate signal so the build fails loud rather than silently shipping dead code).

  **New public exports** from `@forinda/kickjs-vite`:
  - `devtoolsStripPlugin(opts?)` — standalone Vite plugin. Auto-registered by `kickjsVitePlugin()` unless `devtools: false` is passed.
  - `stripDevtoolsCode(source, filename, opts?)` — pure transform exposed for testing + adopter tooling that wants to run the same strip outside Vite.
  - `DevtoolsStripOptions`, `StripDevtoolsOptions`, `StripResult` — companion types.

  **New runtime dependency:** `@babel/core ^7.29.0`. Already present transitively across the monorepo; the new direct dep ensures the version stays pinned.

  **Migration notes:** none. The strip is on by default for `kickjsVitePlugin()` users. Adopters who were already gating devtools imports behind `__KICKJS_DEVTOOLS__` see no behavioral change — the flag plugin's constant-folding still runs first; the Babel strip handles the residual cases (custom tab calls at module top level) the flag couldn't reach.

## 5.2.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
