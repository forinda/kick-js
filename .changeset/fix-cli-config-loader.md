---
'@forinda/kickjs-cli': minor
---

feat(cli): load TypeScript configs with jiti + walk-up project root resolution

`kick.config.ts` no longer needs `tsx` wrapping or a manual loader — the CLI now imports it through `jiti` directly. Previously, `loadKickConfig` did a bare `await import('kick.config.ts')` which throws `ERR_UNKNOWN_FILE_EXTENSION` on vanilla Node; the bare `catch` swallowed it and silently returned `null`, so adopters' `plugins[]`, `commands[]`, `modules{}`, and `typegen{}` blocks were all dropped without explanation. The new path uses `jiti` (already a transitive dep across the workspace), and the warning fires only when `jiti` itself can't be resolved.

`loadKickConfig` and `kick typegen` now walk up from the invocation cwd to find `kick.config.*` (or `package.json` as a fallback). Running `kick typegen` from inside `src/` used to resolve `srcDir` and `outDir` against `src/`, producing `src/.kickjs/types/` instead of `<root>/.kickjs/types/`. The new `findProjectRoot()` helper (exported from `@forinda/kickjs-cli`) makes this deterministic: it returns the first ancestor with a `kick.config.*`, or — only as a fallback — the first ancestor with a `package.json`.

Also drops a handful of stale `graphql` mentions: the CLI no longer advertises a `--template graphql` flag (never existed; valid set is `rest | ddd | cqrs | minimal`), the `kick g resolver` doc line and the GraphQLAdapter rows in the example `kick inspect` output were removed, and a stray comment in `resolve-out-dir.ts` was corrected. GraphQL remains documented as a BYO recipe via `defineAdapter()` / `definePlugin()` (`docs/guide/migration-v3-to-v4.md`) — that hasn't changed.
