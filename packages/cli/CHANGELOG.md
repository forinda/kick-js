# @forinda/kickjs-cli

## 5.7.0

### Minor Changes

- [#248](https://github.com/forinda/kick-js/pull/248) [`021926e`](https://github.com/forinda/kick-js/commit/021926e88c993230c695e37361bcea7c9ac3e3ba) Thanks [@forinda](https://github.com/forinda)! - feat(cli): `.agents/` subfolder layout + standard SKILL.md format + doc-driven skill enrichment

  `kick g agents` now emits the agent-context files into a structured `.agents/` subfolder, with skills following the standard Claude Code / Copilot CLI per-skill `SKILL.md` format (one directory per skill with YAML frontmatter), and every skill body has been rewritten from the official guide pages to reflect concrete patterns + red flags + nuances.

  **New layout**

  ```
  CLAUDE.md                 # at root — Claude Code auto-loads from here (thin pointer to .agents/)
  .agents/
  ├── AGENTS.md             # canonical multi-agent reference
  ├── GEMINI.md             # Gemini CLI specific notes (NEW)
  ├── COPILOT.md            # Copilot CLI specific notes (NEW)
  └── skills/
      ├── add-module/SKILL.md
      ├── add-adapter/SKILL.md
      ├── add-plugin/SKILL.md                       # NEW
      ├── write-controller-test/SKILL.md
      ├── env-wiring-check/SKILL.md
      ├── bootstrap-export/SKILL.md
      ├── thin-entry-file/SKILL.md
      ├── context-contributor/SKILL.md
      ├── query-parsing-list-endpoint/SKILL.md      # NEW
      ├── use-asset-manager/SKILL.md                # NEW
      ├── cli-commands-cheatsheet/SKILL.md          # NEW
      ├── refresh-agent-docs/SKILL.md
      └── deny-list/SKILL.md
  ```

  Each `SKILL.md` opens with YAML frontmatter (`name: kickjs-<slug>`, `description: <when to use>`) so agents that auto-discover skills (Claude Code, Copilot CLI plugins, Gemini's `activate_skill`) pick each up without an external index file.

  **New API surface**
  - `defineGemini` / `defineCopilot` template helpers exported from `@forinda/kickjs-cli` (alongside the existing `generateAgents` / `generateClaude`).
  - `generateKickJsSkillFiles(name, template, pm): KickJsSkillFile[]` replaces the legacy single-file `generateKickJsSkills` (kept as `@deprecated` for one minor for back-compat).
  - New `--only gemini` and `--only copilot` flags on `kick g agents` for targeted refreshes.
  - New `findProjectRoot()` export — implicit, since `agent-docs.ts` uses it for cwd resolution, but the rest of the CLI was already using it.

  **Migration behaviour**

  When `kick g agents` runs against an existing project, root-level `AGENTS.md` / `kickjs-skills.md` are **left untouched**. The new layout emits alongside — adopters delete the legacy files manually when they're ready. `CLAUDE.md` at the root is rewritten to point at `.agents/` paths.

  **Enriched skill content**

  Each of the 13 skill bodies has been rewritten to faithfully reflect the official docs:
  - **`add-module`** — `defineModule` factory, `import.meta.glob` requirement, versioned route arrays, conditional `setup(registry)` mounting, factory-invocation footgun.
  - **`add-adapter`** — `defineAdapter` factory, lifecycle hook decision tree (`beforeMount` / `beforeStart` / `afterStart` / `shutdown`), middleware phases, `.scoped` / `.async` patterns, `dependsOn` topo-sort, when to promote to a plugin.
  - **`add-plugin`** _(NEW)_ — `definePlugin` factory, inline-literal pattern for one-off DI bindings, execution order, multi-instance, when plugin > adapter.
  - **`write-controller-test`** — `Container.reset()` in `beforeEach`, typed `Ctx<KickRoutes...>`, `Scope.REQUEST` × singleton incompatibility.
  - **`env-wiring-check`** — side-effect import requirement, `reloadEnv` vs `resetEnvCache`, sticky cache, `@Value` `process.env` fallback that masks bugs.
  - **`bootstrap-export`** — Vite HMR + `createTestApp` consequences of missing `export const app`.
  - **`thin-entry-file`** — category-folder split, three middleware signatures (raw Express / `(ctx, next)` / adapter Express again), inline-plugin DI binding pattern.
  - **`context-contributor`** — `defineHttpContextDecorator` + DI `deps` + `dependsOn` topo-sort + ALS three-instance model + error matrix + augmentation completeness.
  - **`query-parsing-list-endpoint`** _(NEW)_ — `ctx.qs` + `ctx.paginate`, operator format, Drizzle column-ref config, allow-list security default.
  - **`use-asset-manager`** _(NEW)_ — `assets.<ns>.<key>()` typed Proxy, `@Asset` decorator, test fixture swap via `KICK_ASSETS_ROOT` + `clearAssetCache()`.
  - **`cli-commands-cheatsheet`** _(NEW)_ — top commands, useful flag combos, lesser-known high-value commands, common red flags.
  - **`refresh-agent-docs`** — updated for the `.agents/` layout.
  - **`deny-list`** — grew to enumerate every cross-skill anti-pattern in one place.

  **Tests** — `__tests__/agent-docs-layout.test.ts` covers the full layout: CLAUDE.md at root, all `.agents/` files emitted, ≥ 13 SKILL.md files with valid frontmatter, existing root-level files untouched, CLAUDE.md pointers correct, package-manager interpolation works.

## 5.6.0

### Minor Changes

- [#244](https://github.com/forinda/kick-js/pull/244) [`e85bf1d`](https://github.com/forinda/kick-js/commit/e85bf1d6b84aedaa803bd989f68f7e2715af9729) Thanks [@forinda](https://github.com/forinda)! - feat(cli): plugin generators register as Commander subcommands + `defineTypegen` helper

  Two related improvements to the CLI plugin authoring surface:

  **`defineTypegen` identity factory.** Mirrors the existing `defineGenerator` ergonomics — adopters can now write `defineTypegen({ id, inputs, generate })` and get full type inference on the `generate(ctx)` body without manually annotating `TypegenPlugin`. Exported alongside `defineGenerator` from `@forinda/kickjs-cli`.

  **Plugin generators surface in `kick g --help` and dispatch via Commander.** Previously, `KickCliPlugin.generators[]` entries were only discoverable through `kick g --list`, and a bare invocation like `kick g drizzle-typegen` (no item arg) silently fell through to the module generator — scaffolding a module called "drizzle-typegen" instead of running the plugin. Two changes fix this:
  1. `KickCliPluginContext` now carries the merged `generators[]` (threaded through by `mergeCliPlugins.register()`), so `register()` callbacks have access to plugin generators at command-registration time.
  2. The built-in `kick/generate` plugin now iterates over `ctx.generators` and registers each as a real Commander subcommand. The subcommand syntax honors the spec's first `args[]` entry (`<schema>` when required, `[schema]` when optional), and declared `flags[]` show up as `--flag` options. The bare-action dispatch is preserved as a safety net for late-discovered generators (e.g. package.json-resolved entries that didn't reach `mergeCliPlugins`).

  The previous `if (names.length >= 2)` gate in the bare action is gone — plugin generators dispatch via Commander whether the adopter passes 0, 1, or N positionals, with required-arg validation handled at the Commander layer.

- [#247](https://github.com/forinda/kick-js/pull/247) [`89f5737`](https://github.com/forinda/kick-js/commit/89f5737c1287233902dd666b3a3df70a64cc1bfc) Thanks [@forinda](https://github.com/forinda)! - chore(cli): drop @forinda/kickjs-auth from every user-facing CLI surface

  `@forinda/kickjs-auth` is no longer offered through the CLI. Adopters who already depend on it keep working — the package itself stays on disk and is unaffected. Only the prompts / scaffolds / registries that proactively suggested it have been pruned. Five surfaces touched:
  1. **`kick new` multi-select** — `Auth` removed from the optional-packages prompt (`init.ts`). New projects no longer see it offered.
  2. **`kick g auth-scaffold`** subcommand removed (`generate.ts`). The `kick g` Commander tree no longer registers the `auth-scaffold` subcommand. Underlying generator file (`generators/auth-scaffold.ts`) kept on disk for now — orphaned code, can be deleted in a follow-up.
  3. **`kick add auth`** registry entry removed (`commands/add.ts`). `kick add --list` no longer surfaces it.
  4. **`SIBLING_PACKAGES`** version-lookup list (`generators/project.ts`) — `@forinda/kickjs-auth` removed so `npm view <name> version` isn't queried at scaffold time for a package the CLI no longer offers.
  5. **`PACKAGE_DEPS`** alias map (`templates/project-config.ts`) — `auth` key removed.

  Imports cleaned up alongside: `generateAuthScaffold`, the local `AuthScaffoldOpts` interface, and the now-unused `select` / `promptConfirm` imports (the only callers were the removed auth-scaffold action).

  Documentation references in `project-docs.ts` template (recipes mentioning `@Public()`, `AuthAdapter`, `JwtStrategy`) intentionally kept — those are example prose, not CLI surfaces, and adopters who explicitly install `@forinda/kickjs-auth` still benefit from the recipes.

- [#241](https://github.com/forinda/kick-js/pull/241) [`36201d6`](https://github.com/forinda/kick-js/commit/36201d6e6ca6eeb19dee0f75817f45d2e5a05c83) Thanks [@forinda](https://github.com/forinda)! - feat(cli): load TypeScript configs with jiti + walk-up project root resolution

  `kick.config.ts` no longer needs `tsx` wrapping or a manual loader — the CLI now imports it through `jiti` directly. Previously, `loadKickConfig` did a bare `await import('kick.config.ts')` which throws `ERR_UNKNOWN_FILE_EXTENSION` on vanilla Node; the bare `catch` swallowed it and silently returned `null`, so adopters' `plugins[]`, `commands[]`, `modules{}`, and `typegen{}` blocks were all dropped without explanation. The new path uses `jiti` (already a transitive dep across the workspace), and the warning fires only when `jiti` itself can't be resolved.

  `loadKickConfig` and `kick typegen` now walk up from the invocation cwd to find `kick.config.*` (or `package.json` as a fallback). Running `kick typegen` from inside `src/` used to resolve `srcDir` and `outDir` against `src/`, producing `src/.kickjs/types/` instead of `<root>/.kickjs/types/`. The new `findProjectRoot()` helper (exported from `@forinda/kickjs-cli`) makes this deterministic: it returns the first ancestor with a `kick.config.*`, or — only as a fallback — the first ancestor with a `package.json`.

  Also drops a handful of stale `graphql` mentions: the CLI no longer advertises a `--template graphql` flag (never existed; valid set is `rest | ddd | cqrs | minimal`), the `kick g resolver` doc line and the GraphQLAdapter rows in the example `kick inspect` output were removed, and a stray comment in `resolve-out-dir.ts` was corrected. GraphQL remains documented as a BYO recipe via `defineAdapter()` / `definePlugin()` (`docs/guide/migration-v3-to-v4.md`) — that hasn't changed.

### Patch Changes

- [#246](https://github.com/forinda/kick-js/pull/246) [`a94780c`](https://github.com/forinda/kick-js/commit/a94780c26ceee6355c4680a5aeed36d83664a021) Thanks [@forinda](https://github.com/forinda)! - feat(http): widen AdapterMiddleware.path + tighten handler typing + clarify lifecycle docs

  Three improvements to the adapter middleware contract, surfacing from a real-world bug-report investigation that found no bug — just sharp edges:

  **1. Widened path scope.** `AdapterMiddleware.path` now accepts `string | RegExp | (string | RegExp)[]` (new `MiddlewarePath` type, exported from `@forinda/kickjs`) instead of a bare `string`. Mirrors Express's native `app.use(path, …)` shape so adopters get the full range without learning a new mini-language:

  ```ts
  middleware() {
    return [
      { handler: rateLimit(), phase: 'beforeRoutes', path: ['/api', '/admin'] },
      { handler: csrf(), phase: 'afterGlobal', path: /^\/api\/v\d+\//, },
      { handler: bodyLog({ region: 'eu' }), phase: 'afterGlobal', path: ['/api', /^\/internal\//] },
    ]
  }
  ```

  The framework copies readonly arrays before passing to Express (`PathParams` requires a mutable array), so adopters can declare paths with `as const` without any runtime workaround.

  **2. Tighter `handler` typing.** `AdapterMiddleware.handler` is now `RequestHandler | ErrorRequestHandler` instead of `any`. Adapters that ship error-handling middleware get type checking; the union resolves via Express's arity-based dispatch.

  **3. Lifecycle JSDoc clarified.** The `MiddlewarePhase` JSDoc spells out the `afterRoutes` semantics — fires **only on fall-through** (no route matched, or a handler called `next()` without ending the response). Controllers that respond with `ctx.json(…)` end the chain and skip this phase. For per-response work (logging, metrics) the doc points adopters at `res.on('finish', …)` from an earlier phase instead. The `kick g middleware` generator template now embeds the same guidance so freshly scaffolded middleware files explain phase trade-offs at the point of use.

  New tests in `__tests__/adapter-middleware-path-patterns.test.ts` exercise every path shape (string prefix, array of strings, single RegExp, mixed array, `as const` readonly array, omitted). The existing `lifecycle-mount-order.test.ts` continues to lock in the order semantics.

- Updated dependencies [[`a94780c`](https://github.com/forinda/kick-js/commit/a94780c26ceee6355c4680a5aeed36d83664a021), [`e0bf64b`](https://github.com/forinda/kick-js/commit/e0bf64b28e032bd2fee88ed397740430c7d74ae8), [`a583829`](https://github.com/forinda/kick-js/commit/a5838298632e419389e3464779b9cb2f049d4392)]:
  - @forinda/kickjs@5.8.0
  - @forinda/kickjs-db@5.9.0

## 5.5.1

### Patch Changes

- Updated dependencies [[`4286e9f`](https://github.com/forinda/kick-js/commit/4286e9f37d5645837fb4a5753ff2e2bb6f198298)]:
  - @forinda/kickjs@5.7.1
  - @forinda/kickjs-db@5.9.0

## 5.5.0

### Minor Changes

- [#236](https://github.com/forinda/kick-js/pull/236) [`a5e6a33`](https://github.com/forinda/kick-js/commit/a5e6a331af581d62022025e499ff496055a9f89a) Thanks [@forinda](https://github.com/forinda)! - fix: close the four DX rough edges from forinda/kick-js#235

  Bundles all four reported issues into one PR per the request. Each lands independently — the failing surface for one didn't depend on any other — but a stacked PR keeps the review and CHANGELOG entry coherent.

  ### §1 — `ContextDecoratorTarget` is now publicly exported

  Adopters wrapping `defineHttpContextDecorator(...)` in a public method-decorator factory hit `TS4058` under `declaration: true` builds because the inferred return type referenced an internal symbol. The interface was already exported from `core/context-decorator.ts`; it just wasn't re-exported from `core/index.ts`. One-line fix — adopters can now annotate their wrapper's return type as `ContextDecoratorTarget` instead of re-deriving the legacy `MethodDecorator` shape locally.

  ```ts
  import {
    defineHttpContextDecorator,
    type ContextDecoratorTarget,
  } from '@forinda/kickjs'

  const RequirePermissionContext = defineHttpContextDecorator<...>({...})

  export function RequirePermission(code: PermissionCode): ContextDecoratorTarget {
    return RequirePermissionContext({ permissionCode: code })
  }
  ```

  ### §2 — `@Autowired` and `@Inject` work in either position

  Both decorators now accept the property-decorator position AND the constructor-parameter-decorator position. Pick whichever name reads better at the call site:

  ```ts
  @Service()
  class UserRepo {
    // Property position — both names work.
    @Autowired(DB) private db1!: KickDbClient
    @Inject(DB) private db2!: KickDbClient

    // Constructor parameter position — both names work.
    constructor(
      @Autowired(LOGGER) private logger: Logger,
      @Inject(CACHE) private cache: Cache,
    ) {}
  }
  ```

  Runtime detects the position via the standard "third arg is a number" check (TypeScript's legacy parameter decorator signature) and routes to the correct metadata bucket (`AUTOWIRED` for properties keyed by prototype + name, `INJECT` for params keyed by constructor + index). The pre-existing no-token reflection-based forms (`@Autowired() private foo!: SomeClass` and `@Inject(SomeClass) foo`) keep working unchanged — `design:type` / `design:paramtypes` fallback still fires when token is undefined.

  7 new unit cases in `packages/kickjs/__tests__/inject-autowired-positions.test.ts` lock the matrix.

  ### §3 — mount-prefix `:params` propagate into `ctx.params` types

  Controllers mounted under a path with parameters (e.g. `/control/orgs/:id/extensions`) no longer need `params: orgIdParamsSchema` repeated on every route to type `ctx.params.id`. The typegen scanner now extracts each module's `routes()` body for `{ path, controller }` pairs and combines the mount path with the per-route path before extracting `:params`. Per-route `params: schema` declarations still override (schema wins over the URL-pattern fallback, as before).

  Multi-mount controllers (rare, e.g. v1 + v2 versioned variants) take the first mount's prefix; the per-route `params: schema` escape hatch handles asymmetric cases.

  6 new unit cases in `packages/cli/__tests__/scanner-mount-path-params.test.ts`.

  ### §4 — typegen warns when a decorated file isn't picked up by any module glob

  The default module template generates `import.meta.glob([patterns])` to side-effect-register decorated classes. Adopters who add a new file type (e.g. `context-decorators/*.ts`) and forget to extend the glob got silent registration drift — the decorator never fires, downstream hits a confusing `MissingContributorError` at request time.

  The typegen scanner now extracts every module file's globs, matches each decorated class file in the module subtree against them, and emits a `console.warn` for orphans:

  ```text
    kick typegen: 1 decorated class(es) not matched by any module's import.meta.glob():
      @Service RequireExtensionEnabled (src/modules/ext/context-decorators/require-extension.ts)
        → not picked up by any glob in src/modules/ext/ext.module.ts
  ```

  Surfaced at every `kick typegen` (and `kick dev` pre-typecheck) run. Doesn't fail the build — adopters who deliberately exclude files keep working — but the orphan is impossible to miss.

  9 new unit cases across `packages/cli/__tests__/scanner-orphaned-classes.test.ts` lock the glob-to-regex translator (`**/` → `(?:.+/)?`, `*` → `[^/]*`, `?` → `.`, negation patterns subtract) and `fileMatchesAnyGlob` semantics.

  ### Numbers

  | Package               | Before    | After           |
  | --------------------- | --------- | --------------- |
  | `@forinda/kickjs`     | 408 tests | 415 tests (+7)  |
  | `@forinda/kickjs-cli` | 276 tests | 291 tests (+15) |

  Minor bumps — all changes additive. Both `@Autowired`/`@Inject` working in either position is a behaviour widening (previously rejected positions now accept) so technically minor; the rest are additive surface (`ContextDecoratorTarget` export, new typegen warning) or scanner internals.

### Patch Changes

- Updated dependencies [[`a5e6a33`](https://github.com/forinda/kick-js/commit/a5e6a331af581d62022025e499ff496055a9f89a)]:
  - @forinda/kickjs@5.7.0
  - @forinda/kickjs-db@5.9.0

## 5.4.7

### Patch Changes

- Updated dependencies [[`c42c33a`](https://github.com/forinda/kick-js/commit/c42c33aac8a40b18bcb7a2e71cba75f5acf21137)]:
  - @forinda/kickjs-db@5.9.0

## 5.4.6

### Patch Changes

- Updated dependencies [[`707e6ba`](https://github.com/forinda/kick-js/commit/707e6ba741d1b25e79fdfd164463346a372c9745)]:
  - @forinda/kickjs-db@5.8.0

## 5.4.5

### Patch Changes

- Updated dependencies [[`ac74a73`](https://github.com/forinda/kick-js/commit/ac74a73e8c8c2e92565cf3f2b535045a23cce30d), [`eb06da2`](https://github.com/forinda/kick-js/commit/eb06da2eb397a68fd577dd0deb312187dcca49db), [`c695340`](https://github.com/forinda/kick-js/commit/c6953404b14ea9b0fc9f5ff0951849418c32d482), [`69a7126`](https://github.com/forinda/kick-js/commit/69a71269f60c1fb1b07bc687ed916da51ab086fa), [`7bc0d23`](https://github.com/forinda/kick-js/commit/7bc0d23084e1fcb8df346856dfb16bb5bd2f2f13)]:
  - @forinda/kickjs-db@5.7.0
  - @forinda/kickjs@5.6.0

## 5.4.4

### Patch Changes

- Updated dependencies [[`f9e24a5`](https://github.com/forinda/kick-js/commit/f9e24a591b1174f50deeec2567082f2194f77555)]:
  - @forinda/kickjs-db@5.6.0

## 5.4.3

### Patch Changes

- [#200](https://github.com/forinda/kick-js/pull/200) [`3dbdd06`](https://github.com/forinda/kick-js/commit/3dbdd06ba8dcf207d5bd4a5dc595c2d3e529182f) Thanks [@forinda](https://github.com/forinda)! - feat(db): refuse `pgEnum` value removal when a composite type references the enum (M4.C)

  The M3.B rename-recreate dance assumes the enum is referenced only by table columns. PG composite types / arrays-of-composite / domains containing the enum break that approach — the `ALTER COLUMN TYPE … USING column::text::foo` clause can't reach into composite fields, so the migration would fail opaquely at apply time.

  Generate-time gate added: when `kick db generate` produces one or more `removeEnumValue` changes, the CLI queries `pg_type` + `pg_attribute` against the configured PG connection. If any composite type holds the enum (directly or as an array element), it refuses to write the migration with a new `CompositeEnumReferenceError` listing every offending `<composite>.<attribute>`.

  The check runs only on the built-in pgAdapter path (`dialect: 'postgres'` + `connectionString`/`DATABASE_URL`). Adopters using the `db.adapter` factory escape hatch get the helper exported from `@forinda/kickjs-db` (`detectCompositeReferences`, `CompositeQueryRunner`, `CompositeRef`) so they can wire it themselves.

  No behavior change when no composite references the enum; no behavior change for non-PG dialects.

- Updated dependencies [[`3dbdd06`](https://github.com/forinda/kick-js/commit/3dbdd06ba8dcf207d5bd4a5dc595c2d3e529182f)]:
  - @forinda/kickjs-db@5.5.0

## 5.4.2

### Patch Changes

- [#198](https://github.com/forinda/kick-js/pull/198) [`8641275`](https://github.com/forinda/kick-js/commit/864127567a836d47c8c125a8ab77b3c2a1acd5f5) Thanks [@forinda](https://github.com/forinda)! - Fix duplicate `KickAssets` augmentation in `.kickjs/types/`.

  The legacy generator kept emitting `assets.d.ts` after the `kick/assets`
  typegen plugin carved out (M2.B-T8), so adopters got two declarations of
  `interface KickAssets` — one in `assets.d.ts`, one in `kick__assets.d.ts`.
  TypeScript merged them silently, but the next field rename or removal
  would surface as TS2717. The plugin is now the sole owner of the
  augmentation.

  `kick typegen` (and `kick dev`'s typegen pass) now sweep stale
  top-level files in `.kickjs/types/` against the union of generator +
  plugin outputs, so projects upgrading from older CLI versions self-heal
  the orphaned `env.ts` / `routes.ts` / `assets.d.ts` from the M2.B-T8
  carve in one run. The output dir is fully owned by typegen (writes its
  own `.gitignore`), so this is non-destructive.

  `index.d.ts` now omits the `import './kick__assets'` side-effect line
  when the project has no `assetMap` entries — the plugin skips emission
  in that case, so importing it would dangle.

## 5.4.1

### Patch Changes

- [#196](https://github.com/forinda/kick-js/pull/196) [`68455f6`](https://github.com/forinda/kick-js/commit/68455f62f45fb83caf72ba5c2a6273c6189114a1) Thanks [@forinda](https://github.com/forinda)! - Three codegen bugs adopters hit on fresh `kick new` projects:

  ## 1. `kick g module` now extends the `defineModules()` chain

  The orchestrator's array-insertion regex only matched flat `[...]` literals. Adopters whose `src/modules/index.ts` used `defineModules().mount(...)` saw new modules' import lines added but the `.mount(NewModule())` call missing — the new module silently never registered.

  Fix: depth-aware scanner detects both shapes. Flat array stays on the existing path; fluent chain gets a balanced-paren walker that handles nested factory calls (`mount(UserModule())`) without the inner parens confusing the boundary.

  ## 2. New projects default to `defineModules()`

  `kick new` and `kick g module` (on a fresh project) now emit:

  ```ts
  import { defineModules } from '@forinda/kickjs'
  import { HelloModule } from './hello/hello.module'

  export const modules = defineModules().mount(HelloModule())
  ```

  instead of the flat `[HelloModule()]` array. Subsequent `kick g module <name>` invocations append `.mount(<Name>Module())` to the chain. Pinning `modules.style: 'class'` in `kick.config.ts` keeps the legacy flat-array form for adopters who prefer it.

  ## 3. `kick new` resolves each `@forinda/kickjs-*` package's actual published version

  Previously `kick new` pinned every kickjs sibling to the CLI's own version (`^5.4.0` for everything). After per-package independent versioning landed, that under-installs adopters whenever a sibling bumps independently — `@forinda/kickjs@5.5.0` may pair with `@forinda/kickjs-cli@5.4.2` and `@forinda/kickjs-swagger@5.3.1`.

  Fix: `kick new` now runs `npm view <name> version` in parallel for every sibling at scaffold time and pins each dep to its own latest. `npm view` failure (offline / unpublished) falls back to the CLI version so the scaffold stays usable.

  Bonus: scaffolded `package.json` now starts at `version: '0.0.0'` instead of inheriting the CLI version. Old behaviour produced apps tagged `5.4.0` on day one, breaking adopters' first npm publish.

  ## 4. Drop `buildRoutes()` mechanics from generated `routes()` JSDoc

  The generated `routes()` JSDoc (DDD / REST / CQRS / scaffold) lectured adopters on how the framework derives the Express Router from the controller via `buildRoutes()` — implementation detail, not API documentation. Replaced with a focused breakdown of the **return value shape**: `path` / `controller` / `version` (with the array-form example for multi-route mounting kept).

  ## 5. Generated agent docs (`CLAUDE.md` / `AGENTS.md` / `kickjs-skills.md`) cover the new module API

  The agent-prompt files emitted by `kick new` now describe `defineModule({...})` + `defineModules().mount(...)` as the default module shape, name `kick.config.ts > modules.style: 'define' | 'class'` as the toggle, and point at `kick codemod modules --experimental --apply` for migrating between the two forms. Cheat-sheet rows updated, registry-array snippets switched to the fluent chain (with the class-form alternative kept as the legacy comment), `AppModule` interface row reframed as legacy.

  ## Tests

  257 → 257 (1 existing test updated to match the new `defineModules()` default; 1 new regression test for chain-append on fluent-form registries). Build + typecheck clean.

## 5.4.0

### Minor Changes

- [#193](https://github.com/forinda/kick-js/pull/193) [`d9918be`](https://github.com/forinda/kick-js/commit/d9918be943f976e758723e2da89348334e921903) Thanks [@forinda](https://github.com/forinda)! - `modules.style` config flag + `kick codemod modules` migration command + style-drift gate on `kick g module`.

  ## What's new

  ### Config flag — `kick.config.ts > modules.style: 'define' | 'class'`

  ```ts
  export default defineConfig({
    modules: {
      style: 'class', // pin to legacy class form; default is 'define'
    },
  })
  ```

  The framework runtime accepts both shapes regardless of this setting — `Application` discriminates `typeof entry === 'function'` at boot. The flag controls codegen output only:

  | Style                | Module file                                     | Modules registry |
  | -------------------- | ----------------------------------------------- | ---------------- |
  | `'define'` (default) | `defineModule({ name, build: () => ({...}) })`  | `[TaskModule()]` |
  | `'class'`            | `class TaskModule implements AppModule { ... }` | `[TaskModule]`   |

  `kick rm module` matches both forms, so flipping the flag mid-project doesn't break un-registration.

  ### `kick codemod modules` — bidirectional migration

  Experimental command that rewrites between the two shapes. **Direction defaults to `modules.style`** from kick.config (or `'define'` when unset), so `kick codemod modules` "just does the right thing" for the project.

  ```bash
  # Default direction = modules.style from kick.config
  kick codemod modules --experimental                 # dry-run preview
  kick codemod modules --experimental --apply         # write changes

  # Override direction explicitly
  kick codemod modules --experimental --apply --target class
  ```

  - **Backup before rewrite** — `--apply` writes a timestamped snapshot to `.kickjs/codemod-backups/<iso-stamp>-modules/` before touching any module file. Adopters not tracking with git can revert with `rm -rf <modulesDir> && mv "<backup>" <modulesDir>`. Skip with `--no-backup`.
  - **Idempotent** — re-running on already-migrated code is a no-op (returns `'already in target form'` per file).
  - **Both module file conventions** — picks up `<modulesDir>/<sub>/<name>.module.ts` (current) AND `<modulesDir>/<sub>/index.ts` (legacy).
  - **Conservative** — files with multiple module classes, decorators on the class, or unrecognized method signatures are reported as `skipped` with a reason and left untouched.

  ### Style-drift gate on `kick g module`

  When `style: 'define'` resolves AND the project still has class-form modules, `kick g module` refuses with an actionable error pointing at `kick codemod modules`:

  ```text
  Error: 1 module file(s) still use the legacy `class … implements AppModule` shape.
    Project setting: modules.style: 'define' (default)

    Files needing migration:
      - src/modules/users/user.module.ts

    Pick one:
      1. Migrate everything to defineModule:
         $ kick codemod modules --experimental --apply
      2. Keep the class form — pin it in kick.config.ts:
         // kick.config.ts
         export default defineConfig({ modules: { style: 'class' } })
  ```

  The gate runs only for `'define'`; `'class'` projects accept either shape since defineModule modules pass through Application's class-vs-instance discriminator at boot.

  ## What changed
  - New `packages/cli/src/generators/migrate-modules.ts` — bidirectional class ↔ defineModule rewriter, registry rewriter (`AppModuleClass[]` ↔ `AppModuleEntry[]` + factory-call vs bare-reference), file walker that handles both `*.module.ts` and legacy `<sub>/index.ts` patterns, backup helper.
  - New `packages/cli/src/commands/codemod.ts` — `kick codemod` namespace (distinct from `kick db migrate`).
  - `kick g module` orchestrator gates on style drift before generating.
  - All four pattern generators (DDD/REST/CQRS/minimal) + scaffold template branch on the resolved style.
  - `kick rm module` + `kick g scaffold` register-loader emit the matching shape.

  ## Tests
  - 11 new unit tests for the migrator: class→define, define→class, idempotency, register-less modules, multi-class refusal, registry rewrites both directions, `index.ts` detection, backup behavior (creates timestamped dir, dry-run skips, --no-backup skips).
  - 3 new integration tests on the gate: default style refuses on legacy modules; style='class' proceeds without checks; style='class' emits class form.

  Suite: 231 → 253 (+22). Build + typecheck clean.

  ## Docs

  `docs/guide/generators.md` "Module declaration style" section covers the flag's effect on codegen output. The `kick codemod modules` command surface lives in the command's `--help` output for now.

- [#191](https://github.com/forinda/kick-js/pull/191) [`dc86690`](https://github.com/forinda/kick-js/commit/dc866902a7ed736f0c16e4d7fd2eb44c55816077) Thanks [@forinda](https://github.com/forinda)! - `defineModule()` factory + simplified `routes()` shape — the fourth `define*` primitive lands and the codegen + docs sweep follows.

  ## `defineModule()` — new factory

  Mirrors `defineAdapter` / `definePlugin` / `defineContextDecorator` so adopters learn one mental model across all four primitives. The legacy `class FooModule implements AppModule { ... }` form keeps working — `bootstrap` accepts either shape and the loader discriminates at boot.

  ```ts
  const TasksModule = defineModule({
    name: 'TasksModule',
    defaults: { scope: 'public' },
    build: (config, { name }) => ({
      register(container) {
        container.registerInstance(`tasks:scope:${name}`, config.scope)
      },
      routes() {
        return { path: `/${config.scope}/tasks`, controller: TasksController }
      },
      contributors() {
        return [LoadTenant.registration]
      },
    }),
  })

  bootstrap({
    modules: [
      TasksModule(), // public scope (defaults)
      TasksModule.scoped('admin', { scope: 'admin' }), // namespaced clone
    ],
  })
  ```

  - `(config?)` call form returns the module instance.
  - `.scoped(scopeName, config?)` returns a namespaced instance (build-context name becomes `${moduleName}:${scope}`).
  - `.definition` exposes the frozen options snapshot for tooling.

  `.async()` is intentionally **not** part of the surface. Module config has no async-resolution window: `register()` and `routes()` both run synchronously during bootstrap, before any adapter `beforeStart` hook fires. Adopters who need async-resolved config push it into an adapter and inject the resolved value into the module via DI tokens.

  Boot-time validation: missing `name`, missing `build`, non-function `build`, non-object options all throw `TypeError` immediately (typically module-load) so adopters get a clear error before bootstrap.

  ## `AppModuleEntry` union type

  `bootstrap({ modules })`, `KickPlugin.modules?()`, and `createTestApp({ modules })` now accept `AppModuleEntry = AppModuleClass | AppModule` so `defineModule`-output instances and legacy classes mix freely in the same array. The Application loader discriminates `typeof entry === 'function'` to dispatch — classes get `new`-ed, instances are used directly.

  ## `defineModules()` — fluent module-list builder

  ```ts
  import { bootstrap, defineModules } from '@forinda/kickjs'

  const modules = defineModules().mount(HelloModule()).mount(TasksModule()).mount(AdminModule())

  await bootstrap({ modules })
  ```

  `defineModules()` returns a `ModuleList` (an `AppModuleEntry[]` subclass with a chainable `.mount()`). Drops into `bootstrap({ modules })` directly — no unwrap step — because `ModuleList extends Array<AppModuleEntry>`. Optional vararg seeds the list inline: `defineModules(HelloModule()).mount(TasksModule())` composes the two forms naturally.

  The plain `[X(), Y()]` array form keeps working — `defineModules()` is the fluent alternative for adopters who prefer the call-then-call pattern that mirrors `definePlugin().scoped(...)` / `defineAdapter()` elsewhere in the framework. Both produce the same shape internally.

  ## `ModuleRoutes` simplified — `controller` alone is sufficient

  ```ts
  // Before
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }

  // After
  routes() {
    return {
      path: '/users',
      controller: UserController,  // framework derives router via buildRoutes() internally
    }
  }
  ```

  The `router` field is now optional — when omitted, the framework calls `buildRoutes(controller)` itself. `controller` was already required for OpenAPI introspection via `SwaggerAdapter`, so the simplification removes the redundant `router: buildRoutes(...)` boilerplate without losing capability. Adopters who hand-build a router (composing multiple controllers, mounting third-party routers) keep passing `router` directly — both shapes are supported.

  Existing modules that still pass `router: buildRoutes(...)` keep working untouched. The new shape just removes the boilerplate going forward.

  ## CLI codegen sweep — `@forinda/kickjs-cli`

  Every module template (`generateModuleIndex` DDD, `generateRestModuleIndex`, `generateMinimalModuleIndex`, `cqrs.ts`'s `generateCqrsModuleIndex`, `scaffold.ts`'s `genModuleIndex`, `project-app.ts`'s `generateHelloModule`) now emits the `defineModule({ name, build })` form with the simplified `{ path, controller }` route shape.

  Each generated `routes()` carries a JSDoc hint demonstrating the array-return + per-entry `version` override so adopters discover that surface from the generated file, not from a separate doc:

  ```ts
  /**
   * Return an array to mount multiple route sets — each entry can
   * override the API version with a `version` field — the mount path
   * becomes `/{apiPrefix}/v{version}{path}`:
   *
   *   return [
   *     { path: '/tasks', version: 1, controller: TasksV1Controller },
   *     { path: '/tasks', version: 2, controller: TasksV2Controller },
   *   ]
   */
  ```

  The `kick g module` orchestrator updates `src/modules/index.ts` to insert the factory-call form (`TasksModule()`) — the type annotation switches from `AppModuleClass[]` to `AppModuleEntry[]`. The `kick rm module` regex updated to match both `Module` and `Module()` forms.

  The `definePlugin` generator's `modules()` return type updated to `AppModuleEntry[]` with a comment explaining that both class and factory forms work.

  The `kick g scaffold` command now refuses with an actionable message when the project pattern isn't `'ddd'` — the field-based scaffold templates only support the DDD layout today, so non-DDD projects need to use `kick g module` until the scaffold variants land.

  ## `@forinda/kickjs-testing`

  `CreateTestAppOptions.modules` switches to `AppModuleEntry[]` so test apps accept both shapes. The isolated-container path inside `createTestApp` discriminates class vs instance the same way Application does — classes get `new`-ed, factory output is used directly. `KickPlugin.modules()` typing in the test-plugin harness updated in lockstep.

  ## Docs sweep

  Active adopter-facing guides updated: `docs/guide/modules.md` (full rewrite leading with `defineModule`), `getting-started.md`, `project-structure.md` (canonical examples). `plugins.md`, `migration-from-express.md`, `testing.md`, `generators.md`, `tutorial-hmr-decorators.md`, `tutorial-generator-patterns.md` get the type-annotation rename so the `AppModuleEntry[]` story is consistent across the docs site. Versioned snapshots under `docs/versions/` left untouched (they're locked to their respective releases).

  ## What's deferred
  - `kick g scaffold` for REST / CQRS / minimal patterns — currently only emits DDD-shaped layouts. The command refuses on non-DDD projects with a clear error pointing at `kick g module` as the workaround.
  - Module-registry pattern for plugins (`.mount(module)` / `.use(module)` factory) — separate design conversation; the flat-array `modules?(): AppModuleEntry[]` is the stable shape for now.

### Patch Changes

- Updated dependencies [[`a812ad5`](https://github.com/forinda/kick-js/commit/a812ad5daa9c3acbe9583eec632a766dadafaea8), [`dc86690`](https://github.com/forinda/kick-js/commit/dc866902a7ed736f0c16e4d7fd2eb44c55816077), [`f5c91f5`](https://github.com/forinda/kick-js/commit/f5c91f53bb42af4ae42eb3fdec4b1d9f312ad1f0)]:
  - @forinda/kickjs@5.5.0
  - @forinda/kickjs-db@5.4.1

## 5.3.2

### Patch Changes

- Updated dependencies [[`8f9c153`](https://github.com/forinda/kick-js/commit/8f9c1533aa0d865b472f93fd02c174799d4767d8)]:
  - @forinda/kickjs-db@5.4.1

## 5.3.1

### Patch Changes

- Updated dependencies [[`c601090`](https://github.com/forinda/kick-js/commit/c60109029a59694da9478dd714cb9aea684765fe), [`6be566a`](https://github.com/forinda/kick-js/commit/6be566a636fe1bbdd3c0b6b56d048f34c2c759e0), [`64ff558`](https://github.com/forinda/kick-js/commit/64ff558a2f1cee096f040a93b44d8eb68cd73255)]:
  - @forinda/kickjs-db@5.4.0

## 5.3.0

### Minor Changes

- [#178](https://github.com/forinda/kick-js/pull/178) [`45fd19d`](https://github.com/forinda/kick-js/commit/45fd19da8ad2856d1ac591b25a112098f9f642ca) Thanks [@forinda](https://github.com/forinda)! - Lossless removal of `pgEnum` values. Previously `kick db generate` emitted a multi-line `--` comment for value removals and the migration ran cleanly with **silent data loss** — the database kept the old value list. The next `kick db generate` cycle would surface the drift, but never the actual removal.

  After this release, removing a value from `pgEnum(...)` produces a real migration carrying the rename-recreate dance:

  ```sql
  -- KICK ENUM REMOVE
  -- enum: "task_priority"
  -- removed: 'unused', 'archived'
  -- columns: tasks.priority
  --
  -- This migration drops values from a PostgreSQL ENUM type. The
  -- runner refuses to apply it without the --confirm-enum-drop flag
  -- (or `confirmEnumDrop: true` in RunnerOptions). Inspect the
  -- column USING clauses below to confirm rows holding a removed
  -- value will fail loudly rather than silently coerce.

  BEGIN;
    ALTER TYPE "task_priority" RENAME TO "task_priority__old";
    CREATE TYPE "task_priority" AS ENUM ('critical', 'high', 'medium', 'low', 'none');
    ALTER TABLE "tasks"
      ALTER COLUMN "priority" TYPE "task_priority"
      USING "priority"::text::"task_priority";
    DROP TYPE "task_priority__old";
  COMMIT;
  ```

  The `-- KICK ENUM REMOVE` literal at the top is the runner's gate signal. `kick db migrate latest` (and `kick db migrate up`) now refuse to apply such migrations unless `--confirm-enum-drop` is passed (or `confirmEnumDrop: true` is set on `RunnerOptions` in adopter code). Without the flag, `MigrationEnumDropError` fires with the affected enums / values / columns _before any DB write_.

  The `USING column::text::foo` clause does the safety check: if any row holds a removed value, the cast fails and the whole transaction rolls back. Operators who need to map removed values to a replacement first must hand-roll a pre-migration that does the data update before generating the structural removal.

  **New public API on `@forinda/kickjs-db`:**
  - `RunnerOptions.confirmEnumDrop?: boolean` — opt-in flag for the runner.
  - `MigrationEnumDropError` — thrown by the gate; carries `id`, `enums`, `removed`, `columns`.
  - `parseEnumDropHeader(sql)` / `enforceEnumDropGate(id, sql, confirmEnumDrop)` / `EnumDropHeader` — exposed for adopters who run migrations through their own tooling and want the same gate semantics.
  - `RemoveEnumValue` change kind extended with `values: readonly string[]` + `affectedColumns: readonly { table: string; column: string }[]`. Adopters reading the diff output programmatically gain access to both the new value list and the column round-trip targets.

  **New CLI flag:** `kick db migrate latest --confirm-enum-drop` (and `kick db migrate up --confirm-enum-drop`). Down-direction commands (`down`, `rollback`) do **not** require the flag — reversing a value removal is `ALTER TYPE … ADD VALUE` per dropped value, which is always cheap.

  **Migration notes for adopters who hand-roll migrations:** none. Existing migrations without the header literal are unaffected. The runner gate is opt-in by header presence; ordinary migrations skip the parse entirely (substring check).

  Spec: `docs/db/spec-enum-value-removal.md`.

- [#178](https://github.com/forinda/kick-js/pull/178) [`efebe58`](https://github.com/forinda/kick-js/commit/efebe584147c2ed97c2741c49efe29164d2976d6) Thanks [@forinda](https://github.com/forinda)! - The kick/db typegen plugin now emits a `KickDbRelationsRegister` augmentation alongside the existing `KickDbSchema` + `KickDbRegister`, so `db.query.X.findMany({ with })` call sites get typed `with` keys without a hand-rolled augmentation file.

  After upgrading + running `kick typegen` (or `kick dev`), `.kickjs/types/kick__db.d.ts` carries:

  ```ts
  declare module '@forinda/kickjs-db' {
    interface KickDbRegister {
      db: KickDbClient<KickDbSchema>
    }

    interface KickDbRelationsRegister {
      db: SchemaToRelationsRegister<typeof appSchema>
    }
  }
  ```

  `SchemaToRelationsRegister<S>` is a new public type-level helper exported from `@forinda/kickjs-db`. It walks the schema barrel for `relations()` declarations and folds them into the registry shape — keyed by source table, each entry mapping `relationName → { kind, target }` with the target shrunk to the literal table name. Adding or removing a relation in `src/db/schema/relations.ts` flows through to call-site type-checking automatically.

  **Type-only refactor on `relations()`:**

  `relations(source, builder)` and the `Helpers.one` / `Helpers.many` factories now preserve the source name and target literal at the type level. The runtime shape is unchanged and all existing call sites remain assignable to the prior less-specific signature; this is strictly a narrowing improvement that makes `SchemaToRelationsRegister<S>` derivable.

  Specifically:
  - `relations()` returns `RelationsDecl<TSourceName, TRelationsMap>` (was `RelationsDecl`).
  - `Helpers.one` returns `RelationOne<TTarget>` (was `RelationOne`).
  - `Helpers.many` returns `RelationMany<TTarget>` (was `RelationMany`).

  Adopters who match against the old return types via `extends RelationsDecl` keep working — both new generics default to the prior open shape.

  **Migration:** Adopters who hand-rolled `KickDbRelationsRegister` augmentations as a stop-gap (suggested in M3.A.5 docs) can delete those files once typegen runs. The auto-emitted shape matches what was hand-written.

### Patch Changes

- Updated dependencies [[`45fd19d`](https://github.com/forinda/kick-js/commit/45fd19da8ad2856d1ac591b25a112098f9f642ca), [`efebe58`](https://github.com/forinda/kick-js/commit/efebe584147c2ed97c2741c49efe29164d2976d6), [`0a63cfc`](https://github.com/forinda/kick-js/commit/0a63cfc90cdc02c94dbdd410ac5f46d1952c3d06), [`b98bcbe`](https://github.com/forinda/kick-js/commit/b98bcbe67ab3fd4bb33039831e3b87702a053919)]:
  - @forinda/kickjs-db@5.3.0

## 5.2.3

### Patch Changes

- Updated dependencies [[`937f514`](https://github.com/forinda/kick-js/commit/937f514d282111299298acabad931c0e7de5c8c7)]:
  - @forinda/kickjs@5.4.0
  - @forinda/kickjs-db@5.2.2

## 5.2.2

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`bc397ce`](https://github.com/forinda/kick-js/commit/bc397ce8c598087ef565f0e5e6cbbe88e1c6cc09) Thanks [@forinda](https://github.com/forinda)! - Token generator now emits PascalCase for the key segment so scaffolded
  `createToken<T>('<scope>/<Key>/<suffix>')` literals satisfy the §22.2
  convention regex out of the box (no `kick-lint` warning on fresh
  scaffolds).

  Before:

  ```ts
  export const USER_REPOSITORY = createToken<IUserRepository>('app/user/repository')
  ```

  After:

  ```ts
  export const USER_REPOSITORY = createToken<IUserRepository>('app/User/repository')
  ```

  Existing scaffolded code keeps working — token literals are arbitrary
  strings; only newly generated files are affected. Generated docs
  (`AGENTS.md`, `CLAUDE.md`, `README.md`) updated to reflect the
  PascalCase key convention.

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

- Updated dependencies [[`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e)]:
  - @forinda/kickjs@5.3.1
  - @forinda/kickjs-db@5.2.2

## 5.2.1

### Patch Changes

- Updated dependencies [[`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98), [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98)]:
  - @forinda/kickjs-db@5.2.1
  - @forinda/kickjs@5.3.0
