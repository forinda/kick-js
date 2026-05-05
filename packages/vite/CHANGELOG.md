# @forinda/kickjs-vite

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
