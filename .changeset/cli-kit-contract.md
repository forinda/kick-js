---
'@forinda/kickjs-cli-kit': minor
'@forinda/kickjs-cli': patch
---

Extract the CLI-plugin contract into a new dependency-free package, `@forinda/kickjs-cli-kit`.

`defineCliPlugin`, `defineGenerator`, `KickCliPlugin`, `KickCliPluginContext`, `GeneratorSpec` (+ friends), `KickCommandDefinition`, and `KickPluginConflictError` now live in `@forinda/kickjs-cli-kit`. This lets packages ship `kick`-compatible commands and generators **without** depending on `@forinda/kickjs-cli` — which previously caused a dependency cycle for first-party packages the CLI itself mounts (e.g. the database tooling).

`@forinda/kickjs-cli` re-exports the whole contract, so existing imports (`import { defineCliPlugin } from '@forinda/kickjs-cli'`) keep working unchanged. The plugin context's config is generic (`KickCliPluginContext<TConfig>`); the CLI narrows it to its `KickConfig`.

No behaviour change — pure contract extraction.
