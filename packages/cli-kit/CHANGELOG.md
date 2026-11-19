# @forinda/kickjs-cli-kit

## 0.1.4

### Patch Changes

- [#1152](https://github.com/forinda/kick-js/pull/1152) [`0656616`](https://github.com/forinda/kick-js/commit/0656616a5c4c67f01a11d10f3507cd78762d09da) Thanks [@forinda](https://github.com/forinda)! - JSDoc and messages now link https://kickjs.app instead of repo files and design-note sections.
  
  - Every public decorator and adapter has JSDoc with a `@see` link to its guide, shown on hover. New JSDoc for `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`, `@Cacheable`, `@CacheResponse`, `KickCronAdapter`, `InertiaAdapter`, `StorageAdapter`, `KickView` and `SocketIoAdapter`.
  - JSDoc that a statement had separated from its export is back on it, so editors show it: `session`, `DevToolsAdapter`, `defineTenancy`, `ContextMetaKey`, `VIEW_RENDERER`, `ResolvedRelation`, `useFileLoader`, `useStripTypes`, `useClientFiles`.
  - Messages that pointed at design-note sections or `guide/…` paths now give the page's URL: `defineModule` and `defineContextDecorator` option errors, kick-lint's token suggestion, and `kick` runtime swap's manual-step note.

## 0.1.3

### Patch Changes

- [#801](https://github.com/forinda/kick-js/pull/801) [`c7c67b5`](https://github.com/forinda/kick-js/commit/c7c67b561cb92259a40f78e56c7135cc02dbcef2) Thanks [@forinda](https://github.com/forinda)! - Shorter README pointing to the documentation site.

## 0.1.2

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

## 0.1.1

### Patch Changes

- [#343](https://github.com/forinda/kick-js/pull/343) [`fe409a2`](https://github.com/forinda/kick-js/commit/fe409a2ef6c16384271e6536a93c89129bf2bccd) Thanks [@forinda](https://github.com/forinda)! - Add a README and bundle the LICENSE in the published package. (0.1.0 was published manually without provenance; this re-syncs the package with the changesets release flow so the next publish ships the docs + a provenance attestation.)

## 0.1.0

### Minor Changes

- [#333](https://github.com/forinda/kick-js/pull/333) [`b6b6832`](https://github.com/forinda/kick-js/commit/b6b683292596bec023104a7fc2b3d8e5a958f36a) Thanks [@forinda](https://github.com/forinda)! - Extract the CLI-plugin contract into a new dependency-free package, `@forinda/kickjs-cli-kit`.

  `defineCliPlugin`, `defineGenerator`, `KickCliPlugin`, `KickCliPluginContext`, `GeneratorSpec` (+ friends), `KickCommandDefinition`, and `KickPluginConflictError` now live in `@forinda/kickjs-cli-kit`. This lets packages ship `kick`-compatible commands and generators **without** depending on `@forinda/kickjs-cli` — which previously caused a dependency cycle for first-party packages the CLI itself mounts (e.g. the database tooling).

  `@forinda/kickjs-cli` re-exports the whole contract, so existing imports (`import { defineCliPlugin } from '@forinda/kickjs-cli'`) keep working unchanged. The plugin context's config is generic (`KickCliPluginContext<TConfig>`); the CLI narrows it to its `KickConfig`.

  No behaviour change — pure contract extraction.
