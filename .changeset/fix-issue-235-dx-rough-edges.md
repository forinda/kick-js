---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
---

fix: close the four DX rough edges from forinda/kick-js#235

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
