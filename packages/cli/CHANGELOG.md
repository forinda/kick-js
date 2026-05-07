# @forinda/kickjs-cli

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
