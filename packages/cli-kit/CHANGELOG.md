# @forinda/kickjs-cli-kit

## 0.1.1

### Patch Changes

- [#343](https://github.com/forinda/kick-js/pull/343) [`fe409a2`](https://github.com/forinda/kick-js/commit/fe409a2ef6c16384271e6536a93c89129bf2bccd) Thanks [@forinda](https://github.com/forinda)! - Add a README and bundle the LICENSE in the published package. (0.1.0 was published manually without provenance; this re-syncs the package with the changesets release flow so the next publish ships the docs + a provenance attestation.)

## 0.1.0

### Minor Changes

- [#333](https://github.com/forinda/kick-js/pull/333) [`b6b6832`](https://github.com/forinda/kick-js/commit/b6b683292596bec023104a7fc2b3d8e5a958f36a) Thanks [@forinda](https://github.com/forinda)! - Extract the CLI-plugin contract into a new dependency-free package, `@forinda/kickjs-cli-kit`.

  `defineCliPlugin`, `defineGenerator`, `KickCliPlugin`, `KickCliPluginContext`, `GeneratorSpec` (+ friends), `KickCommandDefinition`, and `KickPluginConflictError` now live in `@forinda/kickjs-cli-kit`. This lets packages ship `kick`-compatible commands and generators **without** depending on `@forinda/kickjs-cli` — which previously caused a dependency cycle for first-party packages the CLI itself mounts (e.g. the database tooling).

  `@forinda/kickjs-cli` re-exports the whole contract, so existing imports (`import { defineCliPlugin } from '@forinda/kickjs-cli'`) keep working unchanged. The plugin context's config is generic (`KickCliPluginContext<TConfig>`); the CLI narrows it to its `KickConfig`.

  No behaviour change — pure contract extraction.
