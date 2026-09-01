# @forinda/kickjs-testing

## 8.0.0

### Major Changes

- [#595](https://github.com/forinda/kick-js/pull/595) [`ddcd0ba`](https://github.com/forinda/kick-js/commit/ddcd0baf9827205d8070e84f4bbbaf2922969aae) Thanks [@forinda](https://github.com/forinda)! - `middleware` is gone; the option is `middlewares`.
  
  `bootstrap()` took both — `middlewares` as the real name and `middleware` as a
  deprecated alias, with the plural winning when both were set. The alias has
  carried a `@deprecated` tag for several releases, and v8 is the window to drop
  it, so there is one name for one thing:
  
  ```ts
  bootstrap({
    modules,
    middlewares: [helmet(), cors(), requestId()],
  })
  ```
  
  The rename is mechanical and the compiler finds every site: `middleware` is no
  longer a key on `ApplicationOptions`, so passing it is a type error rather than
  a silently ignored object.
  
  Renamed in the same place, for the same reason:
  
  - **`createTestApp({ middlewares })`** — the harness passes the option straight
    through to `bootstrap()`, and a test harness whose option name disagreed with
    the thing it configures is the inconsistency this change exists to remove.
    This is why `@forinda/kickjs-testing` takes a major too.
  - **`createWebApp({ middlewares })`** — the web/edge entry had its own
    `middleware`, ctx-style rather than connect-style, but the same name.
  
  **`AppAdapter.middleware()` and `Plugin.middleware()` are unchanged.** They are a
  different API — a hook returning entries, not an option taking them — and
  nothing about them was ambiguous.
  
  Generated projects emit `middlewares` from the CLI's `rest` template.

### Minor Changes

- [#581](https://github.com/forinda/kick-js/pull/581) [`2ae6a37`](https://github.com/forinda/kick-js/commit/2ae6a37b3f711ddfc9368d17be43b79b68769651) Thanks [@forinda](https://github.com/forinda)! - `createTestApp` overrides accept an `InjectionToken` key.
  
  `overrides` was typed `Record<symbol | string, any>`, but the framework's own
  recommended DI key is `createToken()` — a frozen OBJECT identified by reference.
  TypeScript rejects an object as a computed property key, so the natural call did
  not compile:
  
  ```
  error TS2464: A computed property name must be of type 'string', 'number',
  'symbol', or 'any'.
  ```
  
  Tokens are the documented way to bind an interface to an implementation, and the
  generator emits one per repository, so the one key type most worth overriding in
  a test was the one shape `overrides` could not take.
  
  The obvious workaround is worse than the error: `[TOKEN.name]` is a string, so
  it compiles — and the container keys tokens by reference, so the override is
  accepted and silently never applied.
  
  `overrides` now also accepts entries or a `Map`, both of which preserve the
  token's identity:
  
  ```ts
  const DATABASE = createToken<Database>('app/Db/connection')
  
  await createTestApp({
    modules: [UserModule()],
    overrides: [[DATABASE, fakeDb()]],
  })
  ```
  
  The object form is unchanged for string and symbol keys. A test pins the
  silent-failure case too, so the by-name behaviour cannot drift into looking like
  it works.

- [#563](https://github.com/forinda/kick-js/pull/563) [`54f6503`](https://github.com/forinda/kick-js/commit/54f6503c35aee83206e3141f72e3a105520d4d79) Thanks [@forinda](https://github.com/forinda)! - Let `createTestApp` run the engine you actually deploy.
  
  The harness hardcoded Express and returned `expressApp`, so a project running
  Fastify or h3 in production had its entire suite passing against a different
  engine. Routing, body parsing, status handling and error mapping all live in the
  runtime seam, so a green Express suite says nothing about any of them — the one
  thing an integration test exists to rule out.
  
  `createTestApp` now accepts `runtime`, the same value passed to `bootstrap()`:
  
  ```ts
  import { fastifyRuntime } from '@forinda/kickjs/fastify'
  
  const { app } = await createTestApp({ modules: [UserModule], runtime: fastifyRuntime() })
  const res = await request(app.handle.bind(app)).get('/api/v1/users')
  ```
  
  Drive the returned `app` rather than `expressApp`: `app.handle` is the
  Application's own Node request listener and follows whichever runtime is
  configured, so one suite can run against every engine.
  
  The default middleware follows the runtime too. `createTestApp` defaulted to
  `[express.json()]` unconditionally, and passing it explicitly bypasses the
  Application's own native-body guard — under Fastify the connect parser then
  consumes the stream before Fastify reads it, and a JSON POST hangs until the
  test times out rather than failing. The default is now empty on a runtime that
  reports `nativeBodyParsing`.
  
  `expressApp` still works under the Express runtime. Under any other engine it
  now throws, instead of returning that engine's instance mistyped as
  `express.Express` — which is how a suite silently exercises the wrong runtime.

### Patch Changes

- [#607](https://github.com/forinda/kick-js/pull/607) [`6b0bb1e`](https://github.com/forinda/kick-js/commit/6b0bb1e79184d2bec1534a2eb334a1e21a9ac14f) Thanks [@forinda](https://github.com/forinda)! - Request bodies parse the same way on every runtime.
  
  Each engine brought its own library's opinion about content types, so the same
  request produced three different results ([#590](https://github.com/forinda/kick-js/issues/590)):
  
  | body sent                           | Express     | Fastify   | h3             |
  | ----------------------------------- | ----------- | --------- | -------------- |
  | `application/x-www-form-urlencoded` | `undefined` | **415**   | parsed         |
  | `application/merge-patch+json`      | `undefined` | **415**   | parsed         |
  | malformed `+json`                   | `undefined` | 415       | **raw string** |
  | `text/plain`                        | `undefined` | `'hello'` | `'hello'`      |
  
  `bootstrap({ runtime })` is meant to be swappable. It was not, for any app
  accepting a body outside `application/json`: Express → Fastify turned every
  form post into a 415, and Express → h3 started parsing bodies that previously
  did not, silently changing handlers that guarded on `!ctx.body`.
  
  One policy now decides, in `http/body-policy.ts`, and all four runtimes follow
  it — including the web entry for edge, Bun and Deno:
  
  - `application/json` and `application/*+json` — strict JSON; malformed is 400
  - `application/x-www-form-urlencoded` — parsed to an object
  - `text/*` — the raw string
  - `multipart/*` — unchanged, the upload path consumes the stream itself
  
  **`+json` is JSON by specification, not by liberty.** RFC 6838 §4.2.8: a media
  type "MUST NOT be given names incorporating suffixes for structured syntaxes
  they do not actually employ"; RFC 6839 §2 exists so receivers can do "generic
  processing of the underlying representation". Spring, ASP.NET Core and Hono all
  match the suffix by default. It also means the framework can read back the
  `application/problem+json` it emits for every problem response.
  
  **`text/*` is never JSON-parsed, deliberately.** `text/plain` is one of three
  CORS-safelisted content types, so it crosses origins with no preflight;
  JSON-parsing it would re-open the simple-request CSRF that requiring
  `application/json` closes. h3's own source carries that warning.
  
  Per engine: Express's default chain gains `urlencoded` and `text`, and its JSON
  parser is given both `application/json` and `application/*+json` (`type-is`
  will not match plain JSON against the wildcard alone, so both are required).
  Fastify gains content-type parsers for the same set — deliberately not a `'*'`
  catch-all, which would swallow multipart, since `@fastify/multipart` is itself
  the multipart parser. h3 reads raw and applies the policy instead of calling
  `readBody`, whose own dispatch is where its divergence came from.
  
  `createTestApp` no longer names a middleware list, so the Application applies
  its own defaults. Naming one put it on the user-declared branch, so a test app
  parsed only `application/json` while the same app in production parsed the full
  set — the harness quietly exercised a different pipeline from the one deployed.
  
  **An unsupported type is rejected, not ignored.** A body the framework cannot
  read answers **415** with an `Accept` header naming what it accepts, so the
  sender learns the request was not understood — where previously Express handed
  the handler `undefined` and let it fail somewhere less obvious.
  
  The rejection is for a body that cannot be read, never for the absence of one.
  A bodyless `POST` succeeds whatever its declared type, matching what Spring's
  `readWithMessageConverters` and ASP.NET's `BodyModelBinder` both do. Fastify
  needed this explicitly: it invokes a content-type parser even for an empty
  payload, so without the guard a bodyless POST carrying an unrelated type was
  rejected.
  
  **This is the breaking part.** An Express app that accepted, say,
  `application/xml` and ignored the body now answers 415 to those requests. If you
  were relying on silent ignoring, either handle the type or strip the header
  client-side.
  
  Pinned by a runtime matrix over all three engines: JSON, `+json`, malformed
  `+json`, form-urlencoded, `text/plain` as a string, malformed JSON, a POST with
  no body, 415 for an unsupported type, 415 for a body with no `Content-Type`,
  the `Accept` header on a 415, and no 415 for a bodyless request.
  
  Closes [#590](https://github.com/forinda/kick-js/issues/590)

## 7.0.3

### Patch Changes

- [#509](https://github.com/forinda/kick-js/pull/509) [`778573b`](https://github.com/forinda/kick-js/commit/778573b1e2d23debbb5707e3260998f787ec572a) Thanks [@forinda](https://github.com/forinda)! - Narrow every key-taking surface to the declared `ContextMeta` / `ContextKeys` keys

  Augmenting `ContextMeta` narrowed `dependsOn` and nothing else. `key` on a
  contributor spec, `ctx.get`, `ctx.set`, `ctx.require` and `getRequestValue` were
  all `K extends string`, so in a fully augmented app a typo'd key still compiled
  and failed at runtime — or silently read `undefined`.

  The two questions are different and only one was being asked:

  - `TKeys` — "does **this route** carry the key?" `get` deliberately stays loose
    here, because claiming presence wrongly fails open.
  - `ContextMetaKey` — "does this key exist in the app **at all**?" An undeclared
    key here is a typo, not a maybe-absent value.

  All key positions now use `ContextMetaKey`. Value types were already correct and
  are unchanged: `ctx.get('user')` is `User | undefined`, `ctx.require('user')` is
  `User`, and a key registered only in `ContextKeys` still reads as `unknown`.

  `ContextMetaKey` moved next to the registries it reads in `execution-context`,
  so that module can constrain `get`/`set` without a circular import. It is still
  re-exported from `context-decorator`, so existing imports are unaffected.

  Framework-internal positions that also said `string` — `AnyContributorRegistration`,
  `RequestContext<TKeys>`, the typegen fallback, and `runContributor` in
  `@forinda/kickjs-testing` — moved with them. Those were latent: they stopped
  satisfying the constraint the moment any consumer augmented `ContextMeta`.

  **Back-compat:** with no augmentation `ContextMetaKey` _is_ `string`, so nothing
  changes. Augmented apps get compile errors where they previously had silent
  typos — which is the point of augmenting.

## 7.0.2

### Patch Changes

- [#478](https://github.com/forinda/kick-js/pull/478) [`139c5dd`](https://github.com/forinda/kick-js/commit/139c5dd94346ca2e65d32ad5b2e366cbeae7e6c6) Thanks [@forinda](https://github.com/forinda)! - Close the gap between what context decorators guarantee and what the type system knows, and fix two checks that reported the wrong thing.

  **`ctx.require(key)`** — reads a value a contributor is expected to have produced and throws `MissingContextValueError` (naming the key and route) when it hasn't. `ctx.get(key)` returns `T | undefined` for every key, so consuming a guaranteed value meant `ctx.get(key)!` — an assertion that compiles whether or not the producing decorator is applied to the route. On an authorization value that fails open and silently. `require()` returns `Exclude<MetaValue<K>, undefined>`, so the `!` goes away too. `null` still counts as present — only `undefined` throws, which is why the return type excludes `undefined` rather than using `NonNullable`.

  Compile-time narrowing (making a dropped decorator a `tsc` error) needs per-route context-key unions from typegen and is deferred — the design is recorded in `architecture.md` §20.14.

  **Required params are enforced at the call site.** A required field of `P` with no `paramDefaults` entry must now be supplied wherever the decorator is applied; the bare `@Foo` form, `@Foo()`, and `.registration` are compile errors for such a decorator. Previously `paramDefaults` was the only way to satisfy a required field, which pushed adopters into inventing placeholder defaults (`action: 'settings:read'` on a permission contributor every call site overrides) — and a route that then forgot the argument silently gated on the placeholder. The new optional `requiredParams: ['action']` enforces the same rule at runtime for plain-JS and `as any` call sites.

  **`kick typegen --check` actually fails now.** The wrapper that keeps a transiently-broken plugin from crashing `kick dev` was also catching the deliberate drift error, downgrading it to a `console.warn("… skipped")` and returning an empty result set — so the command exited 0 on drift, for every plugin, since the flag was introduced. Drift now propagates as `TypegenDriftError` listing every stale file in one pass, and a plugin that fails to generate under `--check` fails the gate instead of passing on "keeping previous output".

  **`kick doctor` no longer false-alarms on extended tsconfigs.** The loader followed exactly one level of `extends`, only when it was a string, resolved relative paths against the project root rather than the extending file, looked for bare specifiers only in the project's own `node_modules`, and parsed parent configs as strict JSON. Any one of those made a project that sets `experimentalDecorators` / `emitDecoratorMetadata` in a shared base config get told it was missing them — and lean per-package configs in a monorepo hit all of them. Now: chains of any depth, array `extends` (TS 5.0+), `node_modules` lookup walking up the tree (pnpm hoisting), directory specifiers resolving to `tsconfig.json`, and JSONC parsing (comments and trailing commas) throughout. A tsconfig that exists but can't be parsed now reports as unreadable rather than as missing.

  **Agent docs and the contributor scaffold teach the full surface.** `kick g agents` output covered context contributors thinly enough that agents routinely missed the call-site rules: the `.registration` / `.with({...}).registration` forms that module, adapter, and bootstrap sites actually take (passing the decorator itself is the most common wiring bug), when to reach for `.withParams<P>()`, and how to read a value back. Both the `AGENTS.md` section and the `kickjs-context-contributor` skill now carry the five registration sites, the params rules, the read-back table, and `ctx.get(key)!` / `contributors: [Decorator]` as named red flags.

  `kick g contributor --params` no longer scaffolds placeholder `paramDefaults` (`action: ''`). It emits `requiredParams` instead, so the generated contributor demands its params at every call site — the scaffold was previously teaching the exact pattern that made forgotten arguments silent.

  `ExecutionContext` gains a `require` member. Hand-written implementations of that interface need to add it; `RequestContext` and the `@forinda/kickjs-testing` fake contexts already do.

## 7.0.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

## 7.0.0

## 7.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0

## 5.2.3

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.2.2

### Patch Changes

- [#191](https://github.com/forinda/kick-js/pull/191) [`dc86690`](https://github.com/forinda/kick-js/commit/dc866902a7ed736f0c16e4d7fd2eb44c55816077) Thanks [@forinda](https://github.com/forinda)! - `defineModule()` factory + simplified `routes()` shape — the fourth `define*` primitive lands and the codegen + docs sweep follows.

  ## `defineModule()` — new factory

  Mirrors `defineAdapter` / `definePlugin` / `defineContextDecorator` so adopters learn one mental model across all four primitives. The legacy `class FooModule implements AppModule { ... }` form keeps working — `bootstrap` accepts either shape and the loader discriminates at boot.

  ```ts
  const TasksModule = defineModule({
    name: "TasksModule",
    defaults: { scope: "public" },
    build: (config, { name }) => ({
      register(container) {
        container.registerInstance(`tasks:scope:${name}`, config.scope);
      },
      routes() {
        return { path: `/${config.scope}/tasks`, controller: TasksController };
      },
      contributors() {
        return [LoadTenant.registration];
      },
    }),
  });

  bootstrap({
    modules: [
      TasksModule(), // public scope (defaults)
      TasksModule.scoped("admin", { scope: "admin" }), // namespaced clone
    ],
  });
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
  import { bootstrap, defineModules } from "@forinda/kickjs";

  const modules = defineModules()
    .mount(HelloModule())
    .mount(TasksModule())
    .mount(AdminModule());

  await bootstrap({ modules });
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

## 5.2.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.

  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
