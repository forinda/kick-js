# Migrating to v4

KickJS v4 standardises every first-party DI token under one convention. The runtime contract behind each token (what it resolves to, when it's registered, what scope it lives in) is unchanged — only the token primitive itself changed from `Symbol(...)` to `createToken<T>('kick/<area>/<key>')`.

If you import the framework's token consts by name (`PRISMA_CLIENT`, `MAILER`, `AUTH_USER`, etc.) — **no source changes required**. The const names are stable; only their underlying values changed. Run `pnpm install`, rebuild, ship.

If you bypass the framework consts and hand-roll `Symbol('PrismaClient')` somewhere expecting it to match — read on. Those calls break in v4 and need updating.

## What changed

Every first-party DI token now uses `createToken<T>(name)` returning a typed `InjectionToken<T>`, with names under the reserved `kick/` prefix.

| v3 (Symbol)                                       | v4 (createToken)                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `MAILER = Symbol('MailerService')`                | `MAILER = createToken<MailerService>('kick/mailer/Service')`                     |
| `NOTIFICATIONS = Symbol('NotificationService')`   | `NOTIFICATIONS = createToken<NotificationService>('kick/notifications/Service')` |
| `QUEUE_MANAGER = Symbol('QueueManager')`          | `QUEUE_MANAGER = createToken<QueueService>('kick/queue/Manager')`                |
| `PRISMA_CLIENT = Symbol('PrismaClient')`          | `PRISMA_CLIENT = createToken<unknown>('kick/prisma/Client')`                     |
| `PRISMA_TENANT_CLIENT = Symbol('PrismaTenantDB')` | `PRISMA_TENANT_CLIENT = createToken<unknown>('kick/prisma/Client:tenant')`       |
| `DRIZZLE_DB = Symbol('DrizzleDB')`                | `DRIZZLE_DB = createToken<unknown>('kick/drizzle/DB')`                           |
| `DRIZZLE_TENANT_DB = Symbol('DrizzleTenantDB')`   | `DRIZZLE_TENANT_DB = createToken<unknown>('kick/drizzle/DB:tenant')`             |
| `AUTH_USER = Symbol('AuthUser')`                  | `AUTH_USER = createToken<AuthUser>('kick/auth/User')`                            |
| `TENANT_CONTEXT = Symbol('TenantContext')`        | `TENANT_CONTEXT = createToken<TenantInfo>('kick/tenant/Context')`                |

The const names (left column) didn't change. The values they bind to did.

## Why this changed

Architecture-doc rationale lives in [§22 of `architecture.md`](https://github.com/forinda/kick-js/blob/main/architecture.md#22-di-token-convention--symbol-to-string-migration). The short version:

- **Symbols don't survive serialization** — JSON, worker boundaries, devtools snapshots all drop them.
- **Symbols don't autocomplete.** A typo'd `Symbol('MaillerService')` is a fresh token; the container resolves it to a different missing-binding error than the typo'd literal would.
- **Plugin/adapter ecosystem needs predictability.** The B-6 typegen layer narrows `dependsOn` from a string union; the same machinery narrows `@Inject(token)` once tokens are predictable strings.

## Step 1 — update dependencies

```bash
pnpm up @forinda/kickjs@^4 @forinda/kickjs-auth@^4 @forinda/kickjs-prisma@^4 \
        @forinda/kickjs-drizzle@^4 @forinda/kickjs-multi-tenant@^4 \
        @forinda/kickjs-queue@^4 @forinda/kickjs-mailer@^4 \
        @forinda/kickjs-notifications@^4
```

(Adjust the package list to whatever your project actually uses.)

## Step 2 — rebuild + run typegen

```bash
pnpm build
kick typegen
```

That's it for the common path. Continue reading only if one of the next steps applies to your codebase.

## Step 3 (rare) — hand-rolled Symbol references

If your code does any of the following, update each site to use the framework const or `createToken`:

```ts
// ✗ v3 — relied on Symbol identity matching
container.registerInstance(Symbol('PrismaClient'), prisma)
@Inject(Symbol.for('kick/prisma/Client')) prisma!: PrismaClient

// ✓ v4 — use the token const
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
container.registerInstance(PRISMA_CLIENT, prisma)
@Inject(PRISMA_CLIENT) prisma!: PrismaClient

// ✓ v4 — or if you really need the literal
@Inject('kick/prisma/Client') prisma!: PrismaClient
```

The hand-rolled `Symbol(...)` form was never part of the public contract — it worked accidentally because both halves used `Symbol(...)` with the same argument. v4 doesn't preserve that coincidence.

## Step 4 (advanced) — your own DI tokens

If you ship your own `Symbol(...)` DI tokens, this is a good time to migrate them to `createToken<T>()` too. The convention for **third-party** tokens:

```ts
import { createToken } from '@forinda/kickjs'

// Use your org or product short-name as the scope — DO NOT start with `kick/`.
export const CACHE_PROVIDER = createToken<CacheProvider>('mycorp/CacheProvider')
export const AUDIT_LOG = createToken<AuditLog>('acme/AuditLog')

// Per-instance variants use the colon form, mirroring `defineAdapter.scoped()`.
export const QUEUE_WORKER = createToken<QueueWorker>('mycorp/Worker:emails')
```

The `kick/` prefix is **reserved** for `@forinda/kickjs-*` packages — `kick typegen` will warn on third-party tokens that squat it. Pick something distinct (`mycorp/`, `acme/`, `<your-org>/`) instead.

See [§22.2 of `architecture.md`](https://github.com/forinda/kick-js/blob/main/architecture.md#222-convention) for the full naming spec.

## Step 5 (CI) — block regression

The framework ships [`@forinda/kickjs-lint`](https://www.npmjs.com/package/@forinda/kickjs-lint) — a tiny package with the rules behind the convention. Add it to your project to flag new `Symbol(...)` DI token declarations and warn on `kick/`-prefix squatting:

```bash
pnpm add -D @forinda/kickjs-lint
```

```bash
# adopter project — warns on squatting, errors on Symbol() in token files
kick-lint
```

The framework itself runs `pnpm lint:tokens` (which delegates to `kick-lint --first-party`) in pre-commit and CI. Adopters can do the same — the rule set is identical, only the `--first-party` flag flips the prefix-enforcement direction. See the package's [README](https://github.com/forinda/kick-js/blob/main/packages/lint/README.md) for the rule list.

## `@Controller` — drop the path argument

The `path` parameter on `@Controller` has been documented as deprecated since the modules.routes() refactor — it was stored as metadata but never read by the router or any adapter. v4 removes the parameter entirely.

```diff
- @Controller('/users')
+ @Controller()
  export class UsersController {
    @Get('/:id')
    getById(ctx: RequestContext) { ... }
  }
```

The mount prefix has always come from the module's `routes().path` — a single source of truth that avoids the path-doubling footgun where both the controller and the module spec'd a prefix. If your code passed a string here it was silently ignored at runtime; deletion is mechanical.

If you have many controllers to update, this regex finds and rewrites them in one pass:

```bash
# Dry-run first to see what would change
grep -rn "@Controller(['\"]" --include="*.ts" src/

# Apply (or use your editor's project-wide find/replace)
find src -name '*.ts' -exec sed -i "s/@Controller(['\"][^'\"]*['\"])/@Controller()/g" {} +
```

The framework also drops the now-unused `getControllerPath()` helper and the `METADATA.CONTROLLER_PATH` enum entry. Adopters who imported either (rare — both were unreferenced in adapters and tests) should remove the imports.

## ViewAdapter — drop the `new` keyword

`ViewAdapter` migrated from a `class implements AppAdapter` to a `defineAdapter()` factory in v4. Adopters who configure a template engine call it without `new`:

```diff
  import ejs from 'ejs'
  import { ViewAdapter } from '@forinda/kickjs'

  bootstrap({
    modules,
    adapters: [
-     new ViewAdapter({ engine: ejs, ext: 'ejs', viewsDir: 'src/views' }),
+     ViewAdapter({ engine: ejs, ext: 'ejs', viewsDir: 'src/views' }),
    ],
  })
```

The shape of `ViewAdapterOptions` is unchanged. Only the construction syntax differs.

## Context Contributors API — typed `dependsOn` (no source change required)

The Context Contributor pipeline ([architecture.md §20](https://github.com/forinda/kick-js/blob/main/architecture.md#20-context-contributor-pipeline-issue-107)) didn't change shape in v4 — `defineContextDecorator()`, `contributors()` on adapters / plugins / modules, the precedence ordering, and the topo-sort all behave exactly as in v3. **Adopter code keeps working with zero edits.**

What v4 adds on top is **typed narrowing for `dependsOn`** ([architecture.md §21.2.1](https://github.com/forinda/kick-js/blob/main/architecture.md#2121-plugin-dependency-declaration)). After `kick typegen` runs, the framework's `KickJsPluginRegistry` interface is augmented with every plugin/adapter name the project boots, and the `dependsOn` field on plugins/adapters narrows from `readonly string[]` to `readonly (keyof KickJsPluginRegistry)[]`:

```ts
// Before typegen runs — accepts any string (back-compat).
class AuthAdapter implements AppAdapter {
  name = 'AuthAdapter'
  dependsOn = ['TenantAdapter'] // ✓ accepted as string[]
}

// After `kick typegen` populates KickJsPluginRegistry:
class AuthAdapter implements AppAdapter {
  name = 'AuthAdapter'
  dependsOn = ['TenantAdapter'] // ✓ narrowed to a known name
  // dependsOn = ['Tennant']     // ✗ TS error: not assignable to keyof KickJsPluginRegistry
}
```

Same `[Type] extends [never]` back-compat trick used by `@Value` and the typed `@Inject('literal')` overload — fresh projects that haven't run typegen yet keep compiling; once typegen lands, typo'd names become compile errors instead of boot-time `MissingMountDepError`.

**Migration steps:** none required. The narrowing is opt-in via `kick typegen`. To benefit:

1. Run `kick typegen` (or let `kick dev` do it on every save).
2. Existing `dependsOn` literals get type-checked from the next compile pass.
3. Add `'.kickjs/types/**/*.d.ts'` to your `tsconfig.json` `include` if you haven't already (most adopters did this when first using typegen for `KickRoutes` / `KickJsRegistry`).

Plugins that ship contributors via `contributors()` and depend on another plugin's contributors via `dependsOn` get the same typed list with no source change.

## Related v4 surfaces — also opt-in, no breaks

The `dependsOn` narrowing is one slice of the broader v4 push to make plugin/adapter coordination type-safe. Other v4 surfaces already shipped:

- **`defineAugmentation()`** for advertising augmentable interfaces ([architecture.md §21.3.3](https://github.com/forinda/kick-js/blob/main/architecture.md#2133-standardized-augmentation-registry)).
- **`introspect()`** slot on `defineAdapter()` / `definePlugin()` for DevTools (architecture.md §23) — optional; existing adapters/plugins keep working.
- **Asset Manager** — `assetMap` config + `assets.x.y()` typed accessor + `@Asset` decorator ([guide](asset-manager.md)).
- **DevTools v2 panel** with topology, runtime, memory, and routes tabs (architecture.md §23) — gated by mounting `DevToolsAdapter`; no behaviour change for adopters who don't.

None of these break v3 source. They're all opt-in surfaces that light up when you adopt them.

## What didn't change

- `container.resolve(token)`, `container.registerFactory(token, fn, scope)`, `@Inject(token)` — same signatures, same semantics.
- All scope behaviour (`Scope.SINGLETON`, `Scope.TRANSIENT`, request-scoped via AsyncLocalStorage) — unchanged.
- Decorator metadata addressing — still works through the `METADATA` enum; the underlying values switched from `Symbol` to plain strings (consumers reference `METADATA.<NAME>` not the underlying value, so the change is internal).
- Your own application's tokens — keep working as-is. The migration is opt-in at your end (Step 4 is a nudge, not a requirement).

## Related

- [Dependency Injection](dependency-injection.md) — `createToken<T>`, `KickJsRegistry`, and the four-layer DI hardening.
- [Type Generation](typegen.md) — how `kick typegen` discovers tokens and narrows `@Inject` literals.
- [Architecture §22](https://github.com/forinda/kick-js/blob/main/architecture.md#22-di-token-convention--symbol-to-string-migration) — full convention spec + design rationale.
