---
'@forinda/kickjs-cli': minor
---

feat(cli): propagate `projectRoot` through `GeneratorContext` and `KickCliPluginContext`

Both CLI contexts now carry a resolved `projectRoot` field alongside the existing `cwd`. Plugin authors and generator authors no longer need to call `findProjectRoot(cwd)` themselves to find the directory that owns `kick.config.*` — the value is resolved once at CLI startup and threaded through.

**`GeneratorContext` (`packages/cli/src/generator-extension/define.ts`)**

```ts
export interface GeneratorContext {
  // ...existing fields
  cwd: string // where the CLI was invoked
  projectRoot: string // resolved root via findProjectRoot()
}
```

`buildGeneratorContext` now accepts an optional `projectRoot`. When omitted it derives one from `cwd` via `findProjectRoot()` — zero-config for ad-hoc callers, free for the CLI entry which already resolved it.

**`KickCliPluginContext` (`packages/cli/src/plugin/types.ts`)**

```ts
export interface KickCliPluginContext {
  cwd: string // invocation directory
  projectRoot: string // resolved root
  config: KickConfig | null
  log: (msg: string) => void
  generators?: DiscoveredGenerator[]
}
```

`mergeCliPlugins.register()` now populates `projectRoot` automatically:

- When the caller supplies a ctx, that field wins (test harnesses can inject a different workspace boundary).
- When no ctx is supplied (lightweight test path), the default is `findProjectRoot(process.cwd())`.

**Dispatch threading**

`tryDispatchPluginGenerator` accepts a `projectRoot` field in `DispatchInput` so both the bare-action dispatch and `kick g <subcommand>` Commander dispatch propagate the resolved root from `cli.ts` down to plugin generator `files()` factories.

**Why both contexts?**

`cwd` and `projectRoot` are semantically distinct:

- `cwd` = where the adopter typed the command (could be any subdirectory)
- `projectRoot` = the resolved base that owns `kick.config.*` (or `package.json` as fallback)

Generators that emit "files relative to the project" should now use `ctx.projectRoot` instead of `ctx.cwd`. Existing code that treats `ctx.cwd` as the project root keeps working — the CLI entry point sets `cwd` to the resolved root for back-compat, so the two fields hold the same value at the top of the chain.

**Tests**

- `buildGeneratorContext`: caller-supplied `projectRoot` wins; derived from `cwd` via `findProjectRoot()` when omitted; falls back to `cwd` when no marker file exists anywhere.
- `mergeCliPlugins`: caller `projectRoot` flows through to `ctx`; default ctx populates it from `process.cwd()`.
