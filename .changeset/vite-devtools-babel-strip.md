---
'@forinda/kickjs-vite': minor
---

`@forinda/kickjs-vite` now ships a Babel-based devtools strip alongside the existing `__KICKJS_DEVTOOLS__` flag plugin. On `vite build`, the new `kickjs:devtools-strip` plugin walks each module and removes:

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
