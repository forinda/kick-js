---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': patch
'@forinda/kickjs-testing': patch
---

Close the gap between what context decorators guarantee and what the type system knows, and fix two checks that reported the wrong thing.

**`ctx.require(key)`** — reads a value a contributor is expected to have produced and throws `MissingContextValueError` (naming the key and route) when it hasn't. `ctx.get(key)` returns `T | undefined` for every key, so consuming a guaranteed value meant `ctx.get(key)!` — an assertion that compiles whether or not the producing decorator is applied to the route. On an authorization value that fails open and silently. `require()` returns `NonNullable<MetaValue<K>>`, so the `!` goes away too. `null` still counts as present; only `undefined` throws.

Compile-time narrowing (making a dropped decorator a `tsc` error) needs per-route context-key unions from typegen and is deferred — the design is recorded in `architecture.md` §20.14.

**Required params are enforced at the call site.** A required field of `P` with no `paramDefaults` entry must now be supplied wherever the decorator is applied; the bare `@Foo` form, `@Foo()`, and `.registration` are compile errors for such a decorator. Previously `paramDefaults` was the only way to satisfy a required field, which pushed adopters into inventing placeholder defaults (`action: 'settings:read'` on a permission contributor every call site overrides) — and a route that then forgot the argument silently gated on the placeholder. The new optional `requiredParams: ['action']` enforces the same rule at runtime for plain-JS and `as any` call sites.

**`kick typegen --check` actually fails now.** The wrapper that keeps a transiently-broken plugin from crashing `kick dev` was also catching the deliberate drift error, downgrading it to a `console.warn("… skipped")` and returning an empty result set — so the command exited 0 on drift, for every plugin, since the flag was introduced. Drift now propagates as `TypegenDriftError` listing every stale file in one pass, and a plugin that fails to generate under `--check` fails the gate instead of passing on "keeping previous output".

**`kick doctor` no longer false-alarms on extended tsconfigs.** The loader followed exactly one level of `extends`, only when it was a string, resolved relative paths against the project root rather than the extending file, looked for bare specifiers only in the project's own `node_modules`, and parsed parent configs as strict JSON. Any one of those made a project that sets `experimentalDecorators` / `emitDecoratorMetadata` in a shared base config get told it was missing them — and lean per-package configs in a monorepo hit all of them. Now: chains of any depth, array `extends` (TS 5.0+), `node_modules` lookup walking up the tree (pnpm hoisting), directory specifiers resolving to `tsconfig.json`, and JSONC parsing (comments and trailing commas) throughout. A tsconfig that exists but can't be parsed now reports as unreadable rather than as missing.

**Agent docs and the contributor scaffold teach the full surface.** `kick g agents` output covered context contributors thinly enough that agents routinely missed the call-site rules: the `.registration` / `.with({...}).registration` forms that module, adapter, and bootstrap sites actually take (passing the decorator itself is the most common wiring bug), when to reach for `.withParams<P>()`, and how to read a value back. Both the `AGENTS.md` section and the `kickjs-context-contributor` skill now carry the five registration sites, the params rules, the read-back table, and `ctx.get(key)!` / `contributors: [Decorator]` as named red flags.

`kick g contributor --params` no longer scaffolds placeholder `paramDefaults` (`action: ''`). It emits `requiredParams` instead, so the generated contributor demands its params at every call site — the scaffold was previously teaching the exact pattern that made forgotten arguments silent.

`ExecutionContext` gains a `require` member. Hand-written implementations of that interface need to add it; `RequestContext` and the `@forinda/kickjs-testing` fake contexts already do.
