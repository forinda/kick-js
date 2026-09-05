# @forinda/kickjs-cli

## 8.1.5

### Patch Changes

- [#669](https://github.com/forinda/kick-js/pull/669) [`4b11c13`](https://github.com/forinda/kick-js/commit/4b11c137b969386d56c26ae0276912f5d2177182) Thanks [@forinda](https://github.com/forinda)! - Correct three more generator claims that name Express on engine-neutral surfaces.
  
  `kick g adapter`'s `beforeMount` example used `ctx.app.get(…)` with
  `res.json(…)` — both Express-only — directly below a docblock promising the
  adapter "works on every runtime". It now uses `ctx.http.route(…)`, the seam the
  Application builds over whichever runtime is active, and says when reaching for
  the engine-native `ctx.app` is the right call. The same hook's `path` option
  accepts a string prefix, a RegExp, or an array of either; the docblock described
  only the prefix.
  
  `kick --help` described `kick g middleware` as "Express middleware", and the
  generated AGENTS.md called adapter middleware "raw Express". Both are
  connect-style handlers mounted through the runtime seam, and work under Express,
  Fastify and h3 alike.

- [#670](https://github.com/forinda/kick-js/pull/670) [`d65e58a`](https://github.com/forinda/kick-js/commit/d65e58a9bf3c8ccc79e8419ea8ceba1684226a1a) Thanks [@forinda](https://github.com/forinda)! - Generate DTO schemas against the validation library the project actually installed.
  
  `kick new --schema valibot` (or `yup`) installs exactly one validation library —
  the chosen one and no other. But `kick g dto` and the DTOs `kick g module` emits
  both hardcoded `import { z } from 'zod'`, so every generated schema on such a
  project imported a package that was never installed.
  
  Both now resolve the library from the project's dependencies and emit the
  matching source: `v.pipe(v.string(), …)` with `v.InferOutput` for Valibot,
  `yup.string().required()` with `yup.InferType` for Yup, unchanged Zod otherwise.
  Reading it from the dependency rather than a new config field means projects
  scaffolded before this fix are covered without a config migration; a project
  with none declared still gets Zod, as before.
  
  The schemas stay unwrapped — no `fromZod` / `fromValibot` — because
  `detectSchema()` sniffs the library at runtime and `InferSchemaOutput` reads all
  three for typegen.

## 8.1.4

### Patch Changes

- [#667](https://github.com/forinda/kick-js/pull/667) [`aabde6c`](https://github.com/forinda/kick-js/commit/aabde6c05ed737a8b5fd00ae6ca9e17134fe935c) Thanks [@forinda](https://github.com/forinda)! - Correct three generator/API docblock claims that did not match runtime behaviour.
  
  `kick g middleware` emits a connect-style `(req, res, next)` factory, but its
  docblock recommended `@Middleware(<factory>())`. That decorator invokes its
  handler as `(ctx, next)` — two arguments — so the factory's `next` binds to the
  response slot, no third argument arrives, and the first `next()` throws
  `TypeError: next is not a function` from inside the middleware. The docblock now
  names the mismatch and points at `kick g guard` for the ctx-style shape.
  
  `kick g plugin` listed a lifecycle order that did not match `Application`:
  `adapters()` is read during construction and `middleware()` mounts before
  `modules()`, so a plugin middleware handler cannot resolve anything a plugin
  module registers. It also did not mention that `.async()` resolves config inside
  `onReady`, past every contribution point.
  
  `KickPlugin.middleware()` and the generated hook both described their return as
  "Express middleware". The handlers are mounted through each runtime's
  `useConnect` seam and work on Express, Fastify and h3 alike.
- Updated dependencies [[`aabde6c`](https://github.com/forinda/kick-js/commit/aabde6c05ed737a8b5fd00ae6ca9e17134fe935c)]:
  - @forinda/kickjs@8.3.1
  - @forinda/kickjs-db@7.3.0

## 8.1.3

### Patch Changes

- Updated dependencies [[`8aa7c69`](https://github.com/forinda/kick-js/commit/8aa7c697270157def4e354497e89a03a2c553870), [`9afaee8`](https://github.com/forinda/kick-js/commit/9afaee889ff30c4dac8e4779d1c94f0f4fe7f9f2), [`8426228`](https://github.com/forinda/kick-js/commit/8426228e7efb2b250d0899b4c8ac54aa491760dc), [`0c4124b`](https://github.com/forinda/kick-js/commit/0c4124bd04eebfc04b4407d1abe22158139cbd88), [`c0b3760`](https://github.com/forinda/kick-js/commit/c0b3760b62c3f661d0ea7f7f07cc4b296e973f1b)]:
  - @forinda/kickjs-db@7.3.0

## 8.1.2

### Patch Changes

- [#652](https://github.com/forinda/kick-js/pull/652) [`5a9e827`](https://github.com/forinda/kick-js/commit/5a9e82743776c863e3870f7765a026c830a08dc1) Thanks [@forinda](https://github.com/forinda)! - Fix `typegen failed (routeFlags is not iterable)` on projects with a warm scanner cache.
  
  Adding `routeFlags` to `FileExtract` did not bump `CACHE_VERSION` or extend the
  cached-entry validator, so every project that had run typegen before route flags
  shipped served v2 entries lacking the field and crashed in the join phase. The
  only workaround was deleting `.kickjs/cache/scan.json` by hand.
  
  The cache version is bumped (stale entries are ignored), the validator now
  rejects an entry missing `routeFlags`, and a compile-time check makes the key
  list impossible to forget: adding an array field to `FileExtract` now fails to
  build until the validator lists it.
- Updated dependencies [[`b8e6807`](https://github.com/forinda/kick-js/commit/b8e68077e076c5820f92ff2ca5002a864160d9cb)]:
  - @forinda/kickjs@8.3.0
  - @forinda/kickjs-db@7.2.1

## 8.1.1

### Patch Changes

- Updated dependencies [[`4d1291d`](https://github.com/forinda/kick-js/commit/4d1291de0420fcf856a8c616f22a63acc3ad1e74)]:
  - @forinda/kickjs@8.2.1
  - @forinda/kickjs-db@7.2.1

## 8.1.0

### Minor Changes

- [#637](https://github.com/forinda/kick-js/pull/637) [`f903f2b`](https://github.com/forinda/kick-js/commit/f903f2b53a38a4b92644e32ada30987f3280ceb3) Thanks [@forinda](https://github.com/forinda)! - `kick typegen` generates the `KickRouteFlags` registry.
  
  Every `defineRouteFlag('name')` call in `src/` is collected into `.kickjs/types/kick__route-flags.d.ts`, so declaring the flag is the only step — no hand-written `declare module` block:
  
  ```ts
  // src/flags.ts — all you write
  export const Public = defineRouteFlag('auth.public')
  export const Limit = defineRouteFlag<{ rpm: number }>('rate.limit')
  ```
  
  ```ts
  // .kickjs/types/kick__route-flags.d.ts — generated, refreshed on every `kick dev` save
  declare module '@forinda/kickjs' {
    interface KickRouteFlags {
      'auth.public': true
      'rate.limit': { rpm: number }
    }
  }
  ```
  
  From there a misspelt flag name is a compile error at every consumer (`skipWhen`, `onlyWhen`, `exemptWhen`, `flags.has`), and `flags.get('rate.limit')` is typed rather than `unknown`.
  
  Unlike the `ContextKeys` registry, this one records the **value type** too: a bare flag registers as `true`, an explicit generic registers that type verbatim. Empty project emits an empty registry and every name falls back to `string`.
  
  Disable it like any other plugin: `typegen: { disable: ['kick/route-flags'] }`.

### Patch Changes

- [#637](https://github.com/forinda/kick-js/pull/637) [`426132a`](https://github.com/forinda/kick-js/commit/426132abd1d73f2413c320bff7f66073c21441a9) Thanks [@forinda](https://github.com/forinda)! - `kick add` installs the engine peers your project actually uses.
  
  The catalog listed `express` as a static peer of `@forinda/kickjs`, so `kick add kickjs` pulled Express into a Fastify or h3 project. The HTTP engine is chosen at `bootstrap({ runtime })` — which engine package a project needs is a runtime question, not a fixed dependency.
  
  It now resolves from the project's runtime (the `runtime` field in `kick.config.ts`, else the engine already in `package.json`), matching what `kick new` scaffolds for the same engine:
  
  | Runtime   | Installed with `@forinda/kickjs`             |
  | --------- | -------------------------------------------- |
  | `express` | `express`                                    |
  | `fastify` | `fastify`, `@fastify/middie`, `serve-static` |
  | `h3`      | `h3`, `serve-static`                         |
  
  Resolution order: `--runtime <engine>` (new flag) → `runtime` in `kick.config.ts` → an engine in `dependencies` → an engine in `devDependencies`. A production dependency outranks a dev one, so Fastify in devDependencies (a benchmark, a comparison test) no longer decides what an Express app installs.
  
  When two engines sit at the same level and nothing settles it, `kick add` **stops** instead of guessing — installing writes `package.json` and `node_modules`, so a wrong guess is work to undo — and names both remedies: set `runtime` in `kick.config.ts`, or pass `--runtime` for one command.
  
  `kick add --list` names the resolved engine on the row and accepts the same flag. `kick add upload` already resolved its multipart driver this way; this brings the framework package itself in line.
  
  Also: `kick typegen --list` now prints the file each plugin owns and a copy-pasteable `typegen: { disable: [...] }` snippet, since "which plugin writes this file" is the question you have when deciding to turn one off.
- Updated dependencies [[`17bd26e`](https://github.com/forinda/kick-js/commit/17bd26e05825e86045d589963e291c725d68b8fc), [`aa78fbf`](https://github.com/forinda/kick-js/commit/aa78fbfe7265ea10aa2d1f986e8325fbe875d6f2), [`872bc63`](https://github.com/forinda/kick-js/commit/872bc63d2ec5c0be01b2c28015491f981c911c3c), [`7c4446c`](https://github.com/forinda/kick-js/commit/7c4446c7991bc93a226baeaf861e57180df1711e), [`6983c06`](https://github.com/forinda/kick-js/commit/6983c0693b31e9fdc073868773c6271defa79ece), [`f90e9f4`](https://github.com/forinda/kick-js/commit/f90e9f4a4b8a4daf107acabd852426e8c6eb2957), [`f6da2c0`](https://github.com/forinda/kick-js/commit/f6da2c08bed0f0bcd23be9c8521765c37454eb16), [`42ba41d`](https://github.com/forinda/kick-js/commit/42ba41d99feff8f48e615e1bb6ac2d0774692739)]:
  - @forinda/kickjs@8.2.0
  - @forinda/kickjs-db@7.2.1

## 8.0.2

### Patch Changes

- [#619](https://github.com/forinda/kick-js/pull/619) [`d56d186`](https://github.com/forinda/kick-js/commit/d56d186fd62b6775381d6d508963e64f82900085) Thanks [@forinda](https://github.com/forinda)! - Fix two stale flag lists in `kick g` help text.
  
  - `kick g agents --only` accepts `gemini` and `copilot`, but the option help only
    listed `agents | claude | skills | both | all`.
  - `kick g agents --template` accepts `fullstack` alongside `rest` and `minimal`;
    the help omitted it, and the JSDoc still named the removed `ddd` template as
    the fallback.
  
  Text only — no behaviour change. The matching reference tables in the guide and
  API docs are corrected too, along with a `--repo` flag the scaffold docs
  advertised that `kick g scaffold` never accepted.

- [#618](https://github.com/forinda/kick-js/pull/618) [`a1eb264`](https://github.com/forinda/kick-js/commit/a1eb2649fd0fd0e44e21d039867018136bd429a5) Thanks [@forinda](https://github.com/forinda)! - Fix `kick g agents` help text, which still advertised files the generator no longer writes.
  
  `--help` (and the generator list) described the output as "AGENTS.md + CLAUDE.md +
  kickjs-skills.md". Since the move to the `.agents/` layout there is no `kickjs-skills.md`:
  the command writes `.agents/AGENTS.md`, `.agents/GEMINI.md`, `.agents/COPILOT.md`, one
  `.agents/skills/<slug>/SKILL.md` per skill, and `CLAUDE.md` at the project root. The
  `--only skills` JSDoc pointed at the same missing file.
  
  Text only — no behaviour change.

## 8.0.1

### Patch Changes

- [#610](https://github.com/forinda/kick-js/pull/610) [`9b761fc`](https://github.com/forinda/kick-js/commit/9b761fc6f7039117e2b47ce0fd28550e4c245a02) Thanks [@forinda](https://github.com/forinda)! - Fix isolated containers resolving nothing, and a glob that missed half a module.
  
  **`Container.create()` returned a container with no decorator registrations
  ([#608](https://github.com/forinda/kick-js/issues/608)).** Decorators register at class-definition time into whichever container
  was global then, keeping a copy in `allRegistrations` so a fresh container can
  be re-seeded. `Container.reset()` replays that map; `create()` was literally
  `new Container()`, so an isolated container was missing every `@Service`,
  `@Repository` and `@Controller` in the process:
  
  ```text
  KICK001: No provider for PricingService
  ```
  
  `createTestApp({ isolated: true })` and `createTestPlugin` both take that path,
  and `createTestPlugin` defaults `isolated` to true. Worse, the scaffolded
  project docs recommend `Container.create()` for test isolation in five places —
  so the advice every new project ships produced this failure the moment a test
  resolved a decorator-registered class.
  
  `create()` now seeds the same way `reset()` does, through a separate
  `_onCreate` hook that deliberately does **not** reassign the decorators'
  `containerRef`. Seeding and adopting are different things: an isolated
  container should receive what has been registered so far, not become the
  destination for everything registered next. Pinned by a test that the isolated
  container resolves the service, agrees with the shared one, and still does not
  leak either way.
  
  **Isolated containers also leaked, in the other direction.** `registerInstance`,
  `registerFactory` and `resolve`'s singleton cache all wrote to the persistent
  store — the `globalThis` map that exists so the GLOBAL container survives HMR
  and module re-evaluation. `Container.reset()` replays that store, so an override
  registered in an isolated container reappeared in every later test:
  
  ```ts
  Container.create().registerInstance('probe', { v: 1 })
  Container.reset()
  Container.getInstance().has('probe') // true
  ```
  
  `createTestApp({ isolated: true, overrides })` takes exactly that path, so the
  option meant to isolate tests was contaminating them. The reads leaked the same
  way in reverse: `registerFactory` adopted a globally cached instance, so a
  freshly created isolated container could start out already polluted.
  
  Persistence is now scoped to the global singleton by an explicit `isGlobal`
  flag, rather than inferred. Pinned by three tests: an override does not survive
  a reset, a resolved factory instance does not either, and the isolated container
  is still a distinct object from the global one.
  
  **The generated module's eager glob only matched three suffixes ([#609](https://github.com/forinda/kick-js/issues/609)).** It
  covered `*.controller.ts`, `*.service.ts` and `*.repository.ts`, so a decorated
  class in `*.usecase.ts`, `*.policy.ts` or `*.mapper.ts` was never imported,
  never registered, and failed later as `No provider for X`. A routed class was
  pulled in transitively by its controller, so the gap only showed for an unrouted
  one reached through `resolve()` or `@Autowired` — the case least likely to be
  covered by the generated tests.
  
  It is now `./**/*.ts` minus tests and declarations. A suffix list only ever
  covers the filenames the generator itself emits, which reproduces the original
  problem in a smaller and less obvious form: it works until an adopter picks a
  fourth name, and nothing warns. `docs/guide/modules.md` describes the same glob
  and is updated with it.
- Updated dependencies [[`8070eb6`](https://github.com/forinda/kick-js/commit/8070eb6dafbba4579f797c5c2d638acbc16aad7f), [`9b761fc`](https://github.com/forinda/kick-js/commit/9b761fc6f7039117e2b47ce0fd28550e4c245a02), [`31677ce`](https://github.com/forinda/kick-js/commit/31677cef0d24a906dfe3ba9c90fc56233b6eb329)]:
  - @forinda/kickjs@8.1.0
  - @forinda/kickjs-db@7.2.1

## 8.0.0

### Major Changes

- [#596](https://github.com/forinda/kick-js/pull/596) [`221499c`](https://github.com/forinda/kick-js/commit/221499ce60d50acd39c6887583c07a8842d6e3f9) Thanks [@forinda](https://github.com/forinda)! - `kick add` no longer offers `auth`, `drizzle` or `prisma`.
  
  The three packages behind those entries — `@forinda/kickjs-auth`,
  `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma` — are removed from the repo.
  All three were marked `private` and frozen at **6.0.1** while the framework moved
  to 7.4, so `kick add auth` installed a package two majors behind the kickjs it
  was being added to. The entries carried deprecation warnings; v8 finishes the
  job.
  
  `kick add auth|drizzle|prisma` now reports an unknown package rather than
  installing one, which is why this is a major for the CLI.
  
  Where each one goes:
  
  | removed                   | replacement                                                                                                                                                                     |
  | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `@forinda/kickjs-auth`    | the [BYO Auth recipe](https://kickjs.dev/guide/byo-recipes.html#auth) — `@LoadAuthUser` / `@RequireRole` / `@Public` composed from `defineContextDecorator` and `defineAdapter` |
  | `@forinda/kickjs-drizzle` | `@forinda/kickjs-db` (`kick add db` / `pg` / `sqlite` / `mysql`), or wire Drizzle directly                                                                                      |
  | `@forinda/kickjs-prisma`  | `@forinda/kickjs-db`, or wire Prisma directly                                                                                                                                   |
  
  The auth decorators went with the package: `@Public`, `@Roles`, `@Can`,
  `@Authenticated`, `AuthAdapter` and `AUTH_USER` lived in
  `@forinda/kickjs-auth`, never in the framework core. The BYO recipe rebuilds
  each of them.
  
  Docs: the Authentication and Authorization guides keep their BYO halves and lose
  the legacy package reference they said would go "in a future major" — this is
  that major. The Authorization guide now also shows the `user` contributor its
  `dependsOn: ['user']` refers to, which was previously only named in passing on
  another page. The outdated Roadmap page is removed.

### Minor Changes

- [#585](https://github.com/forinda/kick-js/pull/585) [`053c547`](https://github.com/forinda/kick-js/commit/053c547f3f403e9d6b6cad378414d7b1a793a6d3) Thanks [@forinda](https://github.com/forinda)! - `kick g module`: the repository is one file, and it stops lying about what it is.
  
  With `modules.repo: { name: 'postgres' }` the generator emitted
  `postgres-audit.repository.ts` whose every method read and wrote an in-memory
  `Map` — bound by the module as the live implementation. The filename and class
  name both asserted Postgres, so an app could be wired, booted and manually
  tested against `PostgresAuditRepository` while every write went to a store that
  empties on restart, with nothing in the types or the logs to say so.
  
  **The name was the lie, not the Map.** The store is gone from the generated
  names, so an in-memory body is honest: this is the repository, currently in
  memory, and the TODO says what to swap in. It still works as generated, which a
  throwing stub would not.
  
  **Three files collapsed to one.** `<module>.repository.ts` now holds the
  factory, the contract and the token:
  
  ```ts
  export function createAuditRepository() {
    const store = new Map<string, AuditResponseDTO>()
    return { async findById(id) { … }, … }
  }
  
  /** The contract, derived from the factory rather than declared beside it. */
  export type AuditRepository = ReturnType<typeof createAuditRepository>
  
  export const AUDIT_REPOSITORY = createToken<AuditRepository>('app/Audit/repository')
  ```
  
  The return type IS the interface, so an implementation cannot drift from its own
  contract, and there is no `IAuditRepository` to keep in step. Swapping stores
  means writing another factory with a compatible return type and calling that one
  in the module — nothing else changes.
  
  The module registers it declaratively:
  
  ```ts
  container.registerFactory(AUDIT_REPOSITORY, () => createAuditRepository())
  ```
  
  Gone with it: the separate interface file, the `InMemory…Repository` class, and
  the store-named class. `drizzle` and `prisma` had no dedicated generators either
  — both already scaffolded the same stub — so their entries in the name maps were
  dead special-casing that produced `DrizzleAuditRepository` for a file containing
  no Drizzle.
  
  `modules.repo` is deprecated as a result: the name no longer changes the
  generated code, only the TODO inside it. It keeps working, and nothing is
  removed without a replacement.

### Patch Changes

- [#576](https://github.com/forinda/kick-js/pull/576) [`79f3806`](https://github.com/forinda/kick-js/commit/79f38065541cd196137612145ac00522fec1591a) Thanks [@forinda](https://github.com/forinda)! - `kick g adapter`: scaffold every hook on `AppAdapter`, and stop calling the
  middleware hook Express-only.
  
  The scaffold emitted 7 of the 10 hooks while its own comment promised "every
  lifecycle hook below is OPTIONAL. The scaffold emits all of them so adopters can
  browse what's available". `onHealthCheck`, `introspect` and `devtoolsTabs` were
  missing entirely.
  
  `onHealthCheck` is the costly omission: it is the one hook with a built-in
  consumer, since `Application` aggregates every adapter's check through
  `Promise.allSettled` and serves the result at `GET /health/ready`. Undiscoverable
  from the generator, adopters wrote their own readiness endpoints instead of
  contributing a check to the built-in one. `introspect` and `devtoolsTabs` feed
  DevTools and had the same problem.
  
  Each new hook names its consumer, so the scaffold says what the hook is _for_
  rather than only that it exists. `onHealthCheck` ships uncommented and compiles
  as generated; the two DevTools hooks are commented out like their neighbours,
  since `devtoolsTabs` needs an import from `@forinda/kickjs-devtools-kit`.
  
  The middleware hook's comment said "Express middleware entries" on every
  project, including one configured for Fastify or h3. It now says connect-style,
  which is accurate on all three engines.
  
  A new test pins the full hook list against `AppAdapter`, so the scaffold cannot
  silently fall behind the interface again.

- [#584](https://github.com/forinda/kick-js/pull/584) [`9d160a9`](https://github.com/forinda/kick-js/commit/9d160a919d42be3437a5d0bb22ae62097e525588) Thanks [@forinda](https://github.com/forinda)! - Generated project docs: stop calling the bare module form an error.
  
  The scaffolded guidance listed `bootstrap({ modules: [TodosModule] })` as a red
  flag while its own `write-controller-test` snippet used exactly that form — so
  the generated docs contradicted themselves, and following either half could
  produce `TypeError: entry is not a constructor`.
  
  The snippet now follows the project's own `modules.style`, which is threaded
  into the skill generator: a `class` module is passed bare, a `define` module is
  invoked. Emitting one form unconditionally called a class without `new` in
  class-style projects.
  
  The red flag is corrected too — the bare name is accepted for a `define` module
  with no config, and refused for one that takes config, where it would silently
  select the defaults.

- [#583](https://github.com/forinda/kick-js/pull/583) [`d70bd70`](https://github.com/forinda/kick-js/commit/d70bd701cd5d6d51a4fedc77008a50372a499234) Thanks [@forinda](https://github.com/forinda)! - `kick g module`: generated controller tests assert something.
  
  Every case in the generated controller test was `expect(true).toBe(true)`, so a
  new module reported a full green suite while asserting nothing — and kept
  reporting it after every route it named had been deleted. A suite that passes
  unconditionally is worse than no suite: it survives review, and it makes
  `pnpm test` stop carrying information.
  
  In a project with `@forinda/kickjs-testing` and `supertest` — which `kick new`
  installs — the list endpoint is now exercised for real: the module is booted
  through `createTestApp` and the response asserted. The remaining CRUD cases are
  `it.todo`, which the reporter lists as outstanding and which can never be
  counted as coverage.
  
  Without those packages the same scaffold is emitted with every case as a todo
  and no extra imports, since emitting an import for a package that is not
  installed produces a file that cannot compile — the same rule that gates
  `@ApiTags` on `swagger`.
  
  Two details the generated test gets right that are easy to get wrong by hand:
  
  - It passes the module in the shape its declaration style requires —
    `Module()` for `define`, `Module` for `class`. The other way round is
    `TypeError: entry is not a constructor`.
  - It drives `app.handle` rather than an Express app, so the generated suite
    runs on whichever runtime the project is configured with.
  
  The mount path it assumes is stated as a `BASE` constant with the reason:
  `createTestApp` builds its own Application with the framework defaults
  (`apiPrefix: '/api'`, `defaultVersion: 1`) whatever `bootstrap()` uses, so it is
  correct as generated — and the comment shows what to change for an app that
  configures them differently, including `defaultVersion: false`.

- [#598](https://github.com/forinda/kick-js/pull/598) [`f285991`](https://github.com/forinda/kick-js/commit/f2859919a7f2aba833d68550ff05fd376c2cb454) Thanks [@forinda](https://github.com/forinda)! - Scaffolded project docs: fix guidance that contradicts the code beside it.
  
  `project-docs.ts` writes `AGENTS.md` / `CLAUDE.md` into every new project, so a
  stale line there ships to every adopter and is read by their agents as fact.
  
  - **`bootstrap({ middleware })` in eight places.** The option is `middlewares`
    and the singular alias is deleted, so the documented call silently drops every
    global middleware — while `project-app.ts`, written in the same run, correctly
    emits `middlewares:`. The generated docs contradicted the generated code.
  - **`kick add auth`** was the first command under "Adding Features". That entry
    is gone from the catalog; the command now fails.
  - **`container.resolve(InMemoryTodoRepository)`** in the module example. No such
    class is generated — the repository is a `createTodoRepository()` factory, and
    `module-index.ts` emits `registerFactory(TODO_REPO, () => createTodoRepository())`.
  - **`<name>.repository.ts # Data access (@Repository)`** in the folder map. The
    generated file has no decorator and no class.

- [#579](https://github.com/forinda/kick-js/pull/579) [`7f94e8b`](https://github.com/forinda/kick-js/commit/7f94e8b687db70724fd455eaa6cd2906767b1062) Thanks [@forinda](https://github.com/forinda)! - `kick typecheck` refreshes generated types before checking.
  
  `kick dev` runs typegen on startup; `kick typecheck` did not. So the moment a
  handler was renamed or a module deleted without the dev server running, the
  check failed against `.kickjs/types` describing routes that no longer exist:
  
  ```
  .kickjs/types/kick__routes.ts(12,45): error TS2307: Cannot find module
    '../../src/modules/hello/hello.controller'
  src/modules/health/health.controller.ts(11,46): error TS2339: Property 'live'
    does not exist on type 'HealthController'
  ```
  
  The second one is the trap: it points at correct, current source and claims a
  method that does exist is missing, because the stale `KickRoutes` namespace has
  no entry for it. The cause is a generated file the developer never edited and
  may not know about. A pre-commit hook or a fresh clone hits this every time,
  since neither has run the dev server — and a fresh clone has no generated types
  at all.
  
  Typegen failures are reported and swallowed rather than aborting: a typegen
  problem must not masquerade as a type error, and must not stop the check that
  was asked for. `--no-typegen` skips the refresh for a caller that has just run
  typegen itself.

- [#594](https://github.com/forinda/kick-js/pull/594) [`9a18bf4`](https://github.com/forinda/kick-js/commit/9a18bf4c0c03b6a07b15e62923db9d19aa750e05) Thanks [@forinda](https://github.com/forinda)! - `helmet()` options were half-inert, because the framework injected a second one.
  
  `bootstrap()` auto-injects `helmet()` with defaults unless `security.helmet` is
  `false`, and it did so **ahead of the user middleware array**. So an app that
  declared its own `helmet(...)` ran two of them, and the second could only ever
  overwrite a header — never drop one:
  
  ```ts
  bootstrap({ middleware: [helmet({ frameguard: false })] })
  // still: X-Frame-Options: DENY
  ```
  
  Every `false` option behaves this way — `frameguard: false`, `hsts: false`,
  `referrerPolicy: false`, `noSniff: false`. The option is accepted, type-checks,
  and silently does nothing, because the auto-injected pass already set the header
  and the user's pass merely declines to set it again. Disabling `frameguard` to
  allow embedding is the case that bites: the app looks configured and is not.
  
  `helmet()` now brands its handler with `Symbol.for('kick/http/helmet')`, and
  auto-injection stands down when it finds that brand in the declared middleware —
  so a declared helmet is the only one, and its options mean what they say.
  `security.helmet: false` still turns the automatic one off for an app that
  declares nothing.
  
  Read through the registry rather than an import, so the Application keeps the
  dynamic `import()` that lets the helmet module be absent.
  
  **The scaffolded template kept `helmet()`**, now with a comment saying what it is
  for. Reported as a no-op in the `rest` template ([#569](https://github.com/forinda/kick-js/issues/569)) — accurately: it sets the
  same headers the automatic one already set, so adding or removing that line
  changed no response. The measurement was right and the conclusion would have been
  wrong. It is not decoration, it is the configuration seam — and until this fix
  it was a seam that did not work.
  
  Guarded by two tests: an explicit `frameguard: false` removes the header, and a
  bare `helmet()` still emits exactly the same header set as none at all — the
  second being the reporter's own observation, kept so the template's line stays
  honest.

- [#604](https://github.com/forinda/kick-js/pull/604) [`4687f65`](https://github.com/forinda/kick-js/commit/4687f656807d364a28207134262e274db0a9de6d) Thanks [@forinda](https://github.com/forinda)! - `kick new --packages` no longer advertises `auth`.
  
  The flag's help string read `(e.g. auth,swagger,ws,queue)`. `auth` was removed
  from the catalog with the package, so the one example the flag gives is a name
  that now fails.

- [#563](https://github.com/forinda/kick-js/pull/563) [`cfda790`](https://github.com/forinda/kick-js/commit/cfda79054c70e352b4eb232e7a884d3a1809489d) Thanks [@forinda](https://github.com/forinda)! - Stop generated docs and `kick explain` from teaching the Express-only test
  pattern.
  
  Every scaffolded sample drove `request(expressApp)`. The HTTP engine is
  pluggable, so under Fastify or h3 that is the wrong object — and generated docs
  are copied before anyone reads a guide, which propagates the pattern into
  projects that never see the corrected documentation.
  
  The project docs the CLI writes, and the `kick explain` known-issue snippets,
  now destructure `app` and drive `request(app.handle.bind(app))`, which follows
  whichever runtime the app is configured with. A test pins every CLI-emitting
  source so a sample cannot regress.
  
  Pairs with the `runtime` option on `createTestApp` in `@forinda/kickjs-testing`.

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
- Updated dependencies [[`5614f7e`](https://github.com/forinda/kick-js/commit/5614f7e02a57bcd75e5145af2adb8df48cfd1742), [`6c2121f`](https://github.com/forinda/kick-js/commit/6c2121f1fa7c90b3841459a168745b9651f7d137), [`6b0bb1e`](https://github.com/forinda/kick-js/commit/6b0bb1e79184d2bec1534a2eb334a1e21a9ac14f), [`494e94b`](https://github.com/forinda/kick-js/commit/494e94b7615f5352992c7f31ef02845e9d4f68fc), [`9a18bf4`](https://github.com/forinda/kick-js/commit/9a18bf4c0c03b6a07b15e62923db9d19aa750e05), [`76b56da`](https://github.com/forinda/kick-js/commit/76b56da564ad08a6e570210f0ff631948e9bc475), [`f21f01c`](https://github.com/forinda/kick-js/commit/f21f01c1466ef2de9ac2e7e32a209726e143263d), [`dc14396`](https://github.com/forinda/kick-js/commit/dc14396c1dab62967ff97e81304546411af09d9b), [`2e6f981`](https://github.com/forinda/kick-js/commit/2e6f981cd6d79900970c0d6033d0b563d04beaa0), [`62c55ff`](https://github.com/forinda/kick-js/commit/62c55ffe3dba4404ee3f517ecee028ad53317e86), [`9d160a9`](https://github.com/forinda/kick-js/commit/9d160a919d42be3437a5d0bb22ae62097e525588), [`ddcd0ba`](https://github.com/forinda/kick-js/commit/ddcd0baf9827205d8070e84f4bbbaf2922969aae), [`168f4cf`](https://github.com/forinda/kick-js/commit/168f4cfa4d93022be142dacb87e4efeabeafbd02)]:
  - @forinda/kickjs@8.0.0
  - @forinda/kickjs-db@7.2.1

## 7.1.1

### Patch Changes

- [#560](https://github.com/forinda/kick-js/pull/560) [`548eb90`](https://github.com/forinda/kick-js/commit/548eb906cfc522e0ef29fa6858512287145726d1) Thanks [@forinda](https://github.com/forinda)! - Stop emitting methods, symbol keys and truncated types into the client route map.
  
  A response containing a `Buffer` produced a map that would not parse: 34
  `TS1110: Type expected` errors, and nothing downstream could consume it.
  
  Two causes, one symptom. `Buffer` was expanded structurally into a 107-member
  interface — `slice`, `write`, `toJSON`, `reduce` and the rest, each hoisted into
  its own interface. The overloaded ones fell through to `checker.typeToString`,
  which elides long types with `...` by default, and `...` is not type syntax, so
  it landed in the `.d.ts` verbatim.
  
  The map describes a JSON response, and `JSON.stringify` drops functions and
  symbol keys. A method in this map therefore describes a field the client can
  never receive. Properties whose type has call or construct signatures are now
  omitted, as are well-known symbol keys — the checker prints those as
  `__@toStringTag@138`, whose numeric suffix is compiler state rather than
  anything a client could index by, and which would also churn the map's
  fingerprint between compiler versions.
  
  The same rule covers what JSON _transforms_, not only what it drops: a type
  declaring `toJSON()` is emitted as that method's return type. `Date` becomes
  `string` and `Buffer` becomes `{ type: 'Buffer'; data: number[] }` — what the
  client actually receives. One app's map carried 496 bare `Date`s, every one of
  which let `response.createdAt.getFullYear()` compile against a string. This
  assumes the default JSON transport; a client that revives values will have
  richer runtime types than the map claims.
  
  Optional methods and optional callbacks are covered too. The checker adds
  `undefined` to every optional property, so `save?(): void` arrives as
  `(() => void) | undefined`; requiring every union member to be callable kept
  those, which then rendered as `onDone?: {}` — and an optional method earned its
  own empty hoisted interface. A callable member inside any union is dropped as
  well, since `(() => void) | Foo` reaches the client as `Foo` or not at all,
  never as an empty object.
  
  A cycle through `toJSON()` — `A.toJSON(): B` and `B.toJSON(): A` — is emitted
  as `unknown` with a warning. That hop is not structural nesting, so it spends no
  depth, and a direct self-return check cannot see a two-type cycle; nothing
  bounded it but the call stack, which overflowed. Such a value has no
  serializable form, so `unknown` is the honest answer.
  
  Every `typeToString` call now passes `NoTruncation`. Truncated output is never
  valid type syntax, so this is unconditional rather than a heuristic.
  
  Data-only types are unaffected — getters are properties, not callables, so they
  still serialize and are still emitted; lib types like `Date` were already
  emitted by name rather than expanded.
  
  On a 1,940-route app: 34 type errors in the emitted map become 0, hoisted
  interfaces drop from 769 to 691, and the `Buffer` case shrinks from 6,850 bytes
  of unusable output to 1,280 that type-checks.

## 7.1.0

### Minor Changes

- [#558](https://github.com/forinda/kick-js/pull/558) [`7b55ef6`](https://github.com/forinda/kick-js/commit/7b55ef6ce94b94e85f2b7715cd678c9dbc97d689) Thanks [@forinda](https://github.com/forinda)! - Let `typegen.client` take `{ maxDepth }` to tune client-map expansion depth.
  
  A response type is expanded inline up to 12 levels before it is emitted as
  `unknown`. That limit was hardcoded, so a project whose types were genuinely
  deeper had no way to recover the lost fidelity — the only ceiling in the map an
  adopter could not lift.
  
  ```ts
  typegen: {
    client: {
      maxDepth: 24
    }
  }
  ```
  
  The object form is on unless it says otherwise, so `{ maxDepth: 24 }` alone also
  enables the map; `{ enabled: false }` disables it. `client: true` is unchanged.
  
  The default is rarely reached: recursive and named types both hoist into their
  own interface, which costs one level rather than the whole budget, so only deep
  anonymous nesting spends it. On a 1,940-route app the emitted map is
  byte-identical at 12, 24, 48 and 96 — the knob exists for the project where it
  is not, not because the default is wrong.
  
  The depth is part of the map's fingerprint, so changing it rebuilds rather than
  serving the cached map.

### Patch Changes

- [#558](https://github.com/forinda/kick-js/pull/558) [`6942a6f`](https://github.com/forinda/kick-js/commit/6942a6fcf1336a19a4095b7a6e9b2e76bbab08ee) Thanks [@forinda](https://github.com/forinda)! - Fix unbounded expansion of recursive response types in the client route map.
  
  A type alias to an object literal (`type Node = { … }`) carries TypeScript's
  anonymous `__type` symbol rather than the alias name, so the expander did not
  consider it nameable and re-expanded it inline at every occurrence. For a
  _recursive_ alias — zod v4's `JSONSchema`, whose `$defs` is
  `Record<string, JSONSchema>`, or any condition tree — inlining cannot
  terminate, and the walk fanned out exponentially.
  
  Measured on a 1,940-route app: one route produced 8.1 million depth-guard
  warnings and exhausted a 24 GB heap without emitting a map. A second route
  emitted a single 7,000-character property that duplicated its subtree at every
  level and still bottomed out in `unknown`. Neither is a scaling problem — both
  came from individual routes.
  
  An anonymous object type that reaches itself while being rendered now claims a
  name and hoists, so the cycle terminates on that name. Recursive types are
  emitted exactly, as mutually-referencing interfaces, instead of degrading:
  
  ```ts
  interface __T638 { readonly all: readonly (__T638 | __T639 | __T640 | …)[] }
  interface __T639 { readonly any: readonly (__T638 | __T639 | __T640 | …)[] }
  interface __T640 { readonly not: __T638 | __T639 | __T640 | … }
  ```
  
  On that same app: 130s / 15.5 GB / V8 abort with no output → 13.4s / 1.66 GB,
  all 1,940 routes emitted, 325 depth-guard warnings → 0, longest line 7,000 →
  1,644 characters. Route count, typed-response count and `any` count are
  unchanged, so the fidelity is identical — only the pathological expansion is
  gone.
  
  Expansion is now also bounded as a backstop: a route that hits the depth guard
  more than 1,000 times abandons its expansion, emits `unknown`, and says so
  once. The depth guard was firing correctly on every one of those 8.1 million
  warnings — it just never stopped, so the cost was unbounded. Finding that
  meant counting the warnings to notice a single route was responsible.

## 7.0.1

### Patch Changes

- [#556](https://github.com/forinda/kick-js/pull/556) [`484d98d`](https://github.com/forinda/kick-js/commit/484d98da103ae0707d0e249af1a228f7734f2fc1) Thanks [@forinda](https://github.com/forinda)! - Skip rebuilding the client route map when nothing it depends on changed.
  
  Producing the map means building a whole TypeScript program over the server —
  7.5s and 1.2 GB on a 1,940-route app — and it was paid on every `kick typegen`,
  including the many runs where no route had moved. `kick dev` re-runs typegen on
  each restart, so the cost scaled with how often you saved a file rather than
  with what you changed.
  
  Each run now fingerprints what the map is derived from (project sources,
  lockfile, compiler options, CLI version, and the scanned route keys — the scan
  root is configurable and need not sit inside the tsconfig program) and skips the
  pass when it matches the record next to the last emitted map. The record also
  carries the hash of the output those inputs produced, so a skip is only taken
  when the file on disk is still that file. On that same app an unchanged
  run drops to 0.85s and 230 MB. The fingerprint hashes file contents, not
  mtimes, so a rebuild that rewrites identical bytes still skips; a one-character
  source edit does not. Neither `node_modules` (the lockfile stands in for it) nor
  `.kickjs` (typegen's own output, which the scaffolded `tsconfig.json` includes)
  is hashed, and any failure to compute a fingerprint runs the pass — so the
  fallback is the old behaviour rather than a stale file.
  
  The record is `.kickjs/cache/client-map.sha1`, inside the already-ignored
  `.kickjs/` directory; deleting it forces a rebuild. `kick typegen --check`
  leaves it alone, since that flag must not touch the working tree.

## 7.0.0

### Major Changes

- [#553](https://github.com/forinda/kick-js/pull/553) [`7229219`](https://github.com/forinda/kick-js/commit/7229219ce5a537823e17ed7da25e7e630b2ab9d4) Thanks [@forinda](https://github.com/forinda)! - Drop the Prisma/Drizzle repository config, and say why `--repo prisma` no longer presets
  
  BREAKING: `modules.prismaClientPath` is removed. It was part of the exported
  `ModuleConfig`, so an existing `kick.config.ts` that sets it now fails to
  typecheck — delete the line, it did nothing. It was threaded through four layers —
  `kick.config.ts` → module options → `ModuleContext` → `TemplateContext` — and
  consumed by nothing: dead plumbing left behind when the ORM templates were
  taken out, and a Prisma-specific knob in the framework's own config.
  
  A repository shaped to Prisma or Drizzle is that library's interface, not
  KickJS's, and a generator for it is a promise to track someone else's API
  across versions. `--repo prisma` and `--repo drizzle` still scaffold — as the
  generic custom-repository stub every other name produces — and the deprecation
  note now explains that reasoning instead of just saying "deprecated".
  
  `@forinda/kickjs-prisma` and `@forinda/kickjs-drizzle` are unaffected: adapters
  that wire an ORM into DI are first-party code with a first-party interface.
  This is only about generating repository _code_ shaped to a third-party API.

### Minor Changes

- [#550](https://github.com/forinda/kick-js/pull/550) [`d3eddf4`](https://github.com/forinda/kick-js/commit/d3eddf455cd9284bb9588542a9188f04a6b03bc7) Thanks [@forinda](https://github.com/forinda)! - typegen: only build the client route map for projects that use it
  
  Producing `.kickjs/types/kick__client.d.ts` builds a whole TypeScript program
  over the server. On a 1,940-route API that is the entire cost of `kick typegen`:
  
  |            | with the map | without    |
  | ---------- | ------------ | ---------- |
  | wall clock | 7.50s        | **0.59s**  |
  | peak RSS   | 1127 MB      | **182 MB** |
  
  Every other typegen plugin combined accounts for ~130ms of that. An API with no
  frontend was paying twelve seconds and a gigabyte for a file nothing reads.
  
  `typegen.client` now decides:
  
  ```ts
  export default defineConfig({
    typegen: { client: true },
  })
  ```
  
  Off unless set — the config is the switch, not a file on disk. `kick new
  --template fullstack` writes `client: true`, because its web app reads the map.
  
  An existing map does not silently turn it back on; that would leave a project
  paying seconds and a gigabyte per typegen with nothing in its config to explain
  why. It does warn, naming the setting to add, because a map left unrefreshed is
  how a frontend ends up type-checking against routes the server no longer
  serves. Existing adopters therefore need one line of config to keep the map
  current.

- [#550](https://github.com/forinda/kick-js/pull/550) [`8e24bc0`](https://github.com/forinda/kick-js/commit/8e24bc08532e9984bf1bc9cecc071a5efd01758c) Thanks [@forinda](https://github.com/forinda)! - `kick new --template fullstack`: the web app now reads the resolved route map
  
  The scaffolded frontend consumes `server/.kickjs/types/kick__client.d.ts` as an
  ambient type package rather than bridging to the server's route types:
  
  ```jsonc
  // web/tsconfig.json
  "types": ["../server/.kickjs/types/kick__client"]
  ```
  
  ```ts
  // web/src/api.ts
  export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
  ```
  
  `web/src/types/kick-routes.d.ts` is gone, and with it `experimentalDecorators`
  — the map holds resolved literal types, so no server source enters the web
  program. `kick new` runs typegen, so a scaffolded project type-checks
  immediately.
  
  A `types` entry rather than `include` because the failure modes differ: a
  missing map is `TS2688: Cannot find type definition file` with `types`, and
  silence with `include`. Loud is right for something the app depends on. Both
  are documented, along with the explicit-import form and the fact that `types`
  replaces TypeScript's automatic `@types` inclusion.
  
  The fullstack server therefore pins `@typescript/typescript6`, the compiler API
  that resolves the map on TypeScript 7. Only that template does — rest and
  minimal have no frontend, and it is a 10 kB shim over a 24 MB `typescript@6`.
  
  One behaviour change worth knowing: the map is not refreshed by `kick dev`, so
  a renamed response field surfaces on the next `kick typegen` rather than on
  save. `kick typegen --check` catches a stale one in CI.

- [#550](https://github.com/forinda/kick-js/pull/550) [`5afd216`](https://github.com/forinda/kick-js/commit/5afd216dbdcd944e18c287dae41b26a624764efa) Thanks [@forinda](https://github.com/forinda)! - `kick typecheck`: one type-check command, whatever the package manager
  
  Generated projects had to spell type-checking in whichever dialect their
  manager speaks — `pnpm -r exec tsc --noEmit` against
  `cd server && npx tsc --noEmit` — and the fullstack template branched on the
  manager to write them. `kick typecheck` is the same command everywhere, takes
  `--cwd <dir>`, and exits non-zero on errors so it works as a gate.
  
  It resolves the project's own checker, preferring **`vue-tsc`** when installed.
  That preference matters: plain `tsc` does not understand `.vue`, so in a Vue
  project it matches no inputs and reports `TS18003: No inputs were found` while
  real errors sit unchecked in the SFCs. vue-tsc checks plain `.ts` too, so
  preferring it costs nothing.
  
  `kick dev --typecheck` picks up the same preference.

- [#553](https://github.com/forinda/kick-js/pull/553) [`037fff5`](https://github.com/forinda/kick-js/commit/037fff5717f10d2823fd4a6d6ac0dac7fd902894) Thanks [@forinda](https://github.com/forinda)! - Remove `kick g job`
  
  The job generator scaffolded a `@Job` processor around
  `@forinda/kickjs-queue`, a package no template installs — so in most projects
  it wrote a file that could not compile.
  
  The deeper reason is ownership. A generator for an interface KickJS defines —
  `AppAdapter`, `KickPlugin`, a context contributor, a middleware signature —
  prevents a class of mistake that fails at boot rather than at the keyboard, and
  maintaining it is work the framework owes adopters. A queue processor is not
  that shape: it belongs to whichever queue you actually run, which the framework
  cannot know and should not track.
  
  Every other framework-owned generator stays. Also removed:
  `generators/auth-scaffold.ts`, which no command reached — `kick g auth-scaffold`
  was documented but never registered. `defineGenerator` in `kick.config.ts` gives a
  project its own `kick g job` in about twenty lines, shaped to the library it
  chose — see
  [plugin generators](https://kickjs.app/guide/plugin-generators.html), which now
  documents the full `GeneratorSpec` / `GeneratorContext` / `GeneratorFile` API,
  testing, dispatch, and that worked example.

- [#550](https://github.com/forinda/kick-js/pull/550) [`e98a02f`](https://github.com/forinda/kick-js/commit/e98a02f3f9e9b8c18fd5f0778279f99bc2742e2a) Thanks [@forinda](https://github.com/forinda)! - `kick new`: four scripts instead of ten, and oxfmt instead of prettier
  
  Generated projects shipped ten npm scripts, one of which could not run:
  `lint: 'eslint src/'`, with eslint in no dependency list, so `pnpm lint` failed
  with "command not found" in every scaffolded project.
  
  The set is now `dev`, `build`, `start`, `test`. Everything dropped stays one
  command away — `kick dev:debug`, `kick typegen`, `pnpm exec vitest`,
  `pnpm exec tsc --noEmit` — and a scaffold that opens with a wall of aliases
  teaches less than one that shows the binary.
  
  Formatting moves from prettier to **oxfmt**: same options, same output for
  these settings, one binary instead of a package plus plugins — and it is what
  the framework itself is formatted with, so a generated project no longer
  arrives holding a different toolchain than the repo it came from. `.prettierrc`
  becomes `.oxfmtrc.json`, and the `format` / `format:check` / `ci:check`
  commands in the generated `kick.config.ts` follow.
  
  Existing projects are unaffected; this changes only what new ones are created
  with.

- [#550](https://github.com/forinda/kick-js/pull/550) [`5afd216`](https://github.com/forinda/kick-js/commit/5afd216dbdcd944e18c287dae41b26a624764efa) Thanks [@forinda](https://github.com/forinda)! - `kick new`: oxc by default, and no `npx` in anything generated
  
  Generated scripts and `kick.config.ts` commands invoked their tools through
  `npx`, which resolves a missing binary by fetching whatever the registry has
  under that name. For a binary whose package is named differently that is a
  stranger's code: the CLI's binary is `kick`, its package is
  `@forinda/kickjs-cli`, and `kick` on npm is an unrelated AngularJS scaffolder.
  Run from a workspace root where the local binary was not visible, it installed
  that package, printed its help, and exited 0 — so a root `typecheck` script
  passed without type-checking anything.
  
  Generated steps now name tools plainly. `kick`'s custom-command runner puts the
  project's `node_modules/.bin` on PATH, so a step resolves the project's own
  binary and a missing one fails as "command not found" rather than downloading
  something. The fullstack root gains the CLI as a dependency so the bare `kick`
  in its scripts resolves there too.
  
  `oxfmt` and `oxlint` ship as scaffold dependencies, with `lint`, `format`,
  `format:check` and `ci:check` commands wired to them.
  
  Two fixes fell out of the same pass:
  
  - The fullstack root's `typecheck` ran `pnpm -r run typecheck`, which skips
    packages lacking that script — after the script trim, that silently narrowed
    it to the frontend.
  - A scaffolded pnpm workspace could not run any script. The non-interactive
    install left `allowBuilds: '@swc/core': set this to true or false` in
    `pnpm-workspace.yaml`, and pnpm then refuses every script with
    `ERR_PNPM_IGNORED_BUILDS`. The generator answers it now — both are build
    tools this template chose.

### Patch Changes

- [#550](https://github.com/forinda/kick-js/pull/550) [`6865421`](https://github.com/forinda/kick-js/commit/6865421b62f727ef62f2c1fff4d19fd6a1b9f644) Thanks [@forinda](https://github.com/forinda)! - typegen: expose the client route map as an ambient `KickClientApi` namespace
  
  The generated `kick__client.d.ts` now declares a global namespace as well as
  exporting its type, so a frontend that lists the file in its tsconfig
  `include` needs no import at all:
  
  ```ts
  export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
  ```
  
  The explicit form still works for anyone who would rather not have a global:
  
  ```ts
  import type { Api } from '../../server/.kickjs/types/kick__client'
  ```
  
  Two details the shape depends on. The hoisted `__T<n>` interfaces stay
  **module-local** — declaring them at the top level to make them ambient put all
  86 of a real app's shapes into the consuming frontend's global scope. And the
  namespace is `KickClientApi`, not `KickApi`: `kick__routes.ts` already declares
  a global `KickApi`, and both files live in `.kickjs/types`, which the server's
  own tsconfig includes — sharing the name made the _server_ fail to compile with
  `TS2300: Duplicate identifier 'KickApi'`.

- [#550](https://github.com/forinda/kick-js/pull/550) [`ce7c4fb`](https://github.com/forinda/kick-js/commit/ce7c4fb1a3f9547ad0997999c84ef1fcf472f28e) Thanks [@forinda](https://github.com/forinda)! - typegen: stop the client route map's depth guard from firing on hoisted types
  
  A real 1,940-route app emitted 34 copies of:
  
  ```text
  type nesting exceeded 12 levels — emitting 'unknown'. Declare a response schema on the route for an exact type.
  ```
  
  The guard bounds how deeply types nest _inline_, but it was counting through
  hoists. Hoisting ends inline nesting — each named type becomes its own
  top-level `interface __Tn { … }` block, referenced by name — so a chain of
  named DTOs spent the whole budget on a nesting the emitted file does not
  contain. It also corrupted rather than merely truncating: a 15-link chain
  produced `interface __T12 { v: unknown }` where `v` was a plain `string`.
  
  Depth now resets when a type is hoisted. On that app: 34 warnings to 0, and
  the hoisted interfaces go from 10 to 86 as chains expand into their own blocks
  instead of being cut off. Genuinely deep inline nesting still degrades to
  `unknown`, which is what the guard is for.
  
  The warnings also name their route now (`route 'GET /x': …`). Thirty-four
  identical lines with no route between them said nothing about where to look.

- [#550](https://github.com/forinda/kick-js/pull/550) [`5afd216`](https://github.com/forinda/kick-js/commit/5afd216dbdcd944e18c287dae41b26a624764efa) Thanks [@forinda](https://github.com/forinda)! - typegen: fix the client route map emitted before any route exists
  
  With no routes discovered, the map re-exported `Api` from its own filename:
  
  ```ts
  export type { Api } from './kick__client'
  ```
  
  TypeScript rejects that with `TS2303: Circular definition of import alias`, so
  a freshly scaffolded project emitted a file that did not compile — the one
  moment every new project passes through.
  
  It now mirrors the populated form: a module-local `interface Api {}`, the
  ambient `KickClientApi` namespace, and a direct export. Both the namespace and
  the explicit-import forms compile.

- [#550](https://github.com/forinda/kick-js/pull/550) [`63bb62f`](https://github.com/forinda/kick-js/commit/63bb62fb04319203cbe0e1adff30e8c2578d0607) Thanks [@forinda](https://github.com/forinda)! - typegen: stop loading project files the client route map cannot reach
  
  The client map built its TypeScript program over every file the tsconfig
  lists. It does not need to: the probe imports the generated route map, which
  imports the controllers, which import their services and DTOs — so everything
  that can contribute to a route type arrives transitively. Passing the whole
  project on top loaded files no route can reference. On a 1,940-route app, 686
  of the 2,851 roots were tests.
  
  Measured on that app, median of five runs:
  
  |            | before  | after   |
  | ---------- | ------- | ------- |
  | peak RSS   | 1376 MB | 1122 MB |
  | wall clock | 8.62s   | 7.61s   |
  
  with byte-identical output.
  
  Roots are now the tsconfig's declaration files plus everything typegen itself
  emits — and that second list is read from disk rather than taken from the
  tsconfig. TypeScript's `include` skips dot-directories, so `.kickjs/types` was
  absent from the file list unless the adopter happened to spell out a glob for
  it, and `kick__env.ts` carries a `declare global` that nothing imports. Those
  globals were therefore missing for a project that did not glob them, and a
  controller referencing one resolved against an error type — visible in the
  emitted map as a bare identifier the frontend has never heard of.

- [#550](https://github.com/forinda/kick-js/pull/550) [`e98a02f`](https://github.com/forinda/kick-js/commit/e98a02f3f9e9b8c18fd5f0778279f99bc2742e2a) Thanks [@forinda](https://github.com/forinda)! - `kick dev:debug`: actually attach the debugger
  
  The command printed `Debugger: ws://0.0.0.0:9229` and attached nothing. It set
  `process.env.NODE_OPTIONS = '--inspect=…'` and then started the dev server in
  the same process — but Node reads `NODE_OPTIONS` once, at startup, and
  `startDevServer` calls Vite's `createServer` directly rather than spawning. The
  server came up normally and port 9229 stayed closed, so nothing ever failed.
  
  It now uses `inspector.open()`, which opens the port on the running process,
  and prints `inspector.url()` rather than a hand-built one — the real URL
  carries the session id, without which a debugger client cannot attach even to
  an open port.
  
  It also binds to **loopback** now, as `node --inspect` does. The old code
  hardcoded `0.0.0.0`, which never mattered while nothing was listening — but an
  attached inspector can evaluate arbitrary code in the process, so making it
  work turned that into a real open port on every interface. `--inspect-host` is
  there for containers, which legitimately need `0.0.0.0`, and warns when the
  address is not loopback.
  
  A port it cannot take (`Inspector is already activated`) is now reported with a
  pointer to `--inspect-port`, instead of being swallowed.

- [#553](https://github.com/forinda/kick-js/pull/553) [`037fff5`](https://github.com/forinda/kick-js/commit/037fff5717f10d2823fd4a6d6ac0dac7fd902894) Thanks [@forinda](https://github.com/forinda)! - generators: stop emitting imports for packages the project does not have
  
  Two generators wrote code referring to optional packages whether or not the
  project depended on them, producing files that could not compile:
  
  - `kick g module` / `kick g scaffold` emitted
    `import { ApiTags } from '@forinda/kickjs-swagger'` plus five `@ApiTags(...)`
    decorators. The `rest` template does not install swagger, so a generated
    module in a fresh project was broken on arrival — and nobody asked for
    swagger.
  - `kick g job` emitted `import { … } from '@forinda/kickjs-queue'`. That
    generator is removed outright rather than gated — a queue processor's shape
    belongs to whichever queue you run. Add your own with `defineGenerator`.
  
  The decorators are now emitted only when the project declares the dependency.
  Both read `package.json` rather than resolving from `node_modules`: what a
  project declares is what its generated code may import, and a transitively
  installed copy is not a dependency to rely on.
  
  `kick new` was already correct — its swagger and devtools imports are gated on
  `--packages`, which also installs them.

- [#550](https://github.com/forinda/kick-js/pull/550) [`3c0aa5a`](https://github.com/forinda/kick-js/commit/3c0aa5ab2a995dcc94ddb2f592d3c3906ba6043d) Thanks [@forinda](https://github.com/forinda)! - typegen: stop warning about the client route map in projects that do not use it
  
  `kick/client` warned on every `kick typegen` when no TypeScript compiler API
  was available, and reported having "removed the previously generated"
  `kick__client.d.ts` even in projects that never had one — `rm --force`
  succeeds either way.
  
  Most projects do not consume that file. The fullstack template's web app is
  wired to the ambient `KickRoutes.Api` so it stays live under `kick dev`, and
  the rest/minimal templates have no frontend at all. The compiler API is not a
  free thing to tell them to install either: on TypeScript 7 it means
  `@typescript/typescript6`, a 10 kB shim over a 24 MB `typescript@6`.
  
  So the skip is now quiet when there is no map on disk (visible under
  `LOG_LEVEL=debug`) and loud when there is one — a project with a map is using
  it, and losing it is a regression worth interrupting for. The removal notice
  only fires when a file was actually removed, and now prints after the cause it
  refers to.
  
  The fullstack template's README gains a "When to switch to
  `kick__client.d.ts`" section: the one-line swap, the `@typescript/typescript6`
  install it needs on TS 7, the two lines to delete afterwards, and the trade —
  no refresh under `kick dev`, with `--check` as the CI backstop.

## 6.15.1

### Patch Changes

- [#548](https://github.com/forinda/kick-js/pull/548) [`36e4a66`](https://github.com/forinda/kick-js/commit/36e4a66c7b8fec37c1edbf4c5ee20a320398b20f) Thanks [@forinda](https://github.com/forinda)! - typegen: carry values through key-remapped mapped types in the client route map
  
  A handler returning a mapped type with an `as` clause emitted the remapped keys
  correctly and `any` for every value:
  
  ```ts
  type CamelizeKeys<T> = { [K in keyof T as Camel<K>]: T[K] }
  
  // was:  { contactName: any; schoolCount: any }
  // now:  { contactName: string; schoolCount: number }
  ```
  
  Key remapping produces _synthesized_ properties, which have no declaration at
  all. The expander fell back to `getDeclaredTypeOfSymbol` for those — a function
  that answers for type symbols (aliases, interfaces, classes) and returns the
  error type when handed a property. `getTypeOfSymbol` answers for both kinds and
  is now used throughout. The homomorphic form (`{ [K in keyof T]: T[K] }`) only
  ever worked by accident: its properties keep a declaration pointing back at the
  source property.
  
  `any` was the worst available degradation here — `unknown` forces a cast at the
  call site, `any` silently type-checks against anything — so a route returning a
  remapped DTO was less safe than one still emitting `unknown`. On a real
  1,940-route app this removes all 66 `any` fields.

## 6.15.0

### Minor Changes

- [#545](https://github.com/forinda/kick-js/pull/545) [`34bd87a`](https://github.com/forinda/kick-js/commit/34bd87ac9077235cdf5475e61afdbc954545ba87) Thanks [@forinda](https://github.com/forinda)! - `kick typegen`: a route map frontends can use without compiling the server
  
  `KickRoutes.Api` infers response types by referencing controller classes, so a
  frontend that wants `createClient<KickApi>` has to pull the server's source
  graph into its own `tsc` run. On a 1,727-controller app that meant
  `experimentalDecorators`, `emitDecoratorMetadata`, a `paths` fallback into
  server source, five ambient imports — and a typecheck that went from 1.69s /
  819 MB to 10.84s / 4.87 GB, per frontend, per CI run.
  
  `kick typegen` now also emits `.kickjs/types/kick__client.d.ts`: every type
  resolved to a literal shape, shared shapes hoisted to local interfaces,
  module-scoped, and with no imports at all. The frontend needs one line:
  
  ```ts
  import type { KickApi } from '../../../api/.kickjs/types/kick__client'
  ```
  
  Every entry that resolves carries the ambient map's type exactly, because it is
  _produced_ from that map — each one resolved through the server's own program
  rather than inferred a second time — so moving a frontend across changes no call
  sites. A route the resolver cannot resolve is skipped with a warning rather than
  guessed at, so a run that warned yields a subset of `KickRoutes.Api`: the types
  present are still exact, but one may be missing. `kick typegen --check` gates
  staleness in CI.
  
  The file is not refreshed under `kick dev`: resolving the types builds a full
  TypeScript program over the server, which is a build-step cost, not a per-save
  one. Everything else in `.kickjs/types/` keeps updating on save.
  
  Needs a TypeScript compiler API, declared as an optional peer dependency.
  TypeScript 7 ships none, so install `@typescript/typescript6` there. Without
  one, `kick typegen` warns and skips this file rather than failing.

## 6.14.2

### Patch Changes

- [#542](https://github.com/forinda/kick-js/pull/542) [`8539000`](https://github.com/forinda/kick-js/commit/8539000d37125613eab37bb1f843b7406936886f) Thanks [@forinda](https://github.com/forinda)! - `kick new`: stop pinning siblings to the CLI's own version when the registry query fails
  
  `resolveSiblingVersions()` queries `npm view <pkg> version` per package and fell
  back to the CLI's own version on failure. Sibling packages version
  independently, so that fallback names a release that does not exist and the
  scaffold died at install time:
  
  ```text
  npm error 404 '@forinda/kickjs-vite@^6.14.1' is not in this registry
  ```
  
  Three changes:
  
  - The fallback is now `latest`, which always resolves. `@forinda/kickjs-cli`
    keeps the version pin, since there it is genuinely the right one.
  - The queries actually run concurrently. `captureCommand` is `execFileSync`, so
    the existing `Promise.all` ran all ten serially — new `captureCommandAsync`
    fixes that.
  - The per-query timeout goes from 5s to 20s. A warm `npm view` against the
    public registry measures 0.6–3.6s per package, so 5s was one slow response
    away from expiring.
  
  A scaffold that had to fall back now says so instead of failing later.

## 6.14.1

### Patch Changes

- Updated dependencies [[`166e3ee`](https://github.com/forinda/kick-js/commit/166e3ee69f7711a39deb74677dbedaac1ddbb715)]:
  - @forinda/kickjs@7.4.0
  - @forinda/kickjs-db@7.2.1

## 6.14.0

### Minor Changes

- [#532](https://github.com/forinda/kick-js/pull/532) [`b2911e8`](https://github.com/forinda/kick-js/commit/b2911e875a10e3d7d90b53a49801b2bad0095f36) Thanks [@forinda](https://github.com/forinda)! - Add a `guard-vs-middleware-vs-contributor` skill to the generated agent docs.
  
  Guards had one mention across every generated skill — a row in the docs-lookup
  table. Nothing said that KickJS has no guard primitive (a guard is a `(ctx, next)`
  middleware attached with `@Middleware()`, not a `CanActivate` class), that
  guards run before context contributors on every runtime, or that `ctx.res` is
  engine-native so `ctx.res.status(401).json(...)` is Express-only. The new skill
  covers the three-way choice, the ordering, and those traps; `kick g guard` /
  `g middleware` / `g contributor` are now in the CLI cheatsheet too.

- [#533](https://github.com/forinda/kick-js/pull/533) [`49c324c`](https://github.com/forinda/kick-js/commit/49c324c5650c6f1a68d994a4f5041a1ffaf8486e) Thanks [@forinda](https://github.com/forinda)! - `kick g middleware` now types the handler for the project's configured runtime.
  
  With `runtime: 'express'` in `kick.config.ts` it emits
  `(req: Request, res: Response, next: NextFunction)` from `express` — those
  scaffolds already carry `@types/express`, and only Express hands the handler its
  own request/response, so `req.originalUrl` and `res.json()` stop needing a cast.
  Fastify and h3 keep `node:http` types, which is what they actually receive
  (`request.raw` under Fastify, the node objects under h3).
  
  The express shape is opt-in on an explicit `runtime: 'express'`, never on an
  absent field: an unset `runtime` means a hand-written or pre-`--runtime` config
  that says nothing about the engine, and emitting `express` imports there is
  exactly how the original cross-runtime bug shipped.

### Patch Changes

- Updated dependencies [[`97aaab5`](https://github.com/forinda/kick-js/commit/97aaab589d3c5e159e8dfe9981a768b2f4f24ddb), [`3c83390`](https://github.com/forinda/kick-js/commit/3c8339046188ae418152b1a11bd48894aa87f941)]:
  - @forinda/kickjs-db@7.2.1
  - @forinda/kickjs@7.3.0

## 6.13.0

### Minor Changes

- [#523](https://github.com/forinda/kick-js/pull/523) [`edd6935`](https://github.com/forinda/kick-js/commit/edd69351b3a7866d3de585726cf61c312a68f14d) Thanks [@forinda](https://github.com/forinda)! - Consolidate the agent skills onto one source and add a docs-lookup skill.

  The skills existed twice: a structured array rendered to
  `.agents/skills/<slug>/SKILL.md`, and `generateKickJsSkills()`, which restated
  them by hand as one aggregate markdown file. The copy had drifted to 9 skills
  against 13, and its env recipe still named a superseded API — a fix applied to
  one copy silently missed the other, which is how the stale `createTestApp`
  signature survived as long as it did.

  `generateKickJsSkills()` turned out to have no callers at all: nothing writes
  `kickjs-skills.md`, so those lines were dead as well as duplicated, which is
  why nobody noticed the drift. Removed rather than rewired.

  New `kickjs-docs-lookup` skill points at the online guides plus the local
  tools (`kick explain`, `kick doctor`, `kick inspect`, `.kickjs/types/`, the
  installed `.d.mts`) for anything the short skills do not cover. The skills
  carry the traps; the docs carry the API surface. It also states the precedence
  rule: when a doc page and the installed types disagree, the types win.

  `AGENTS.md` is slimmed from 574 to 378 lines. Seven sections restated content
  the skills already own — Testing Guidelines was a near-verbatim third copy of
  the `write-controller-test` skill, and Common Pitfalls held a fourth copy of
  the env story that still named a superseded API and recommended a test-isolation
  approach we have since disproved. Those now point at the skill that owns the
  topic. Sections with no skill equivalent — runtime neutrality, conventions,
  project layout, the decorator table — are untouched.

### Patch Changes

- [#523](https://github.com/forinda/kick-js/pull/523) [`68566a3`](https://github.com/forinda/kick-js/commit/68566a3bfb82bd2bb7ceb9230a0a75c040caa886) Thanks [@forinda](https://github.com/forinda)! - Deprecate `defineAugmentation`.

  It existed to publish a typegen catalogue of augmentable interfaces, from when
  Context Contributors were still settling and adopters needed to discover what
  could be augmented. Contributors are a stable typed API now, so the catalogue
  buys nothing while costing a second call that has to be kept in step with the
  `declare module` block — and which never contributed a single type. Forgetting
  one of the pair was itself a documented footgun.

  Nothing breaks. `kick typegen` still discovers the call and still writes the
  catalogue. Drop it and keep the `declare module '@forinda/kickjs'` block, which
  is what actually types `ctx.get(...)`.

  Verified against the real pipeline rather than the docstring: a call emits one
  empty marker interface in `.kickjs/types/kick__augmentations.d.ts` —

  ```ts
  export interface ContextMetaAugmentation {}
  ```

  with the description and example as its JSDoc and a `@see` to the call site.
  The interface is empty and unreferenced, so nothing consumes it at type level.

  That check also turned up the catalogue's filename being wrong in five places —
  the JSDoc, both public guides, and two inline comments all still named the
  legacy `augmentations.d.ts` rather than the `kick__augmentations.d.ts` the
  plugin has been writing. Corrected, and both guides now carry the deprecation.

  The scaffolded contributor skill no longer teaches it, and the two deny-list
  entries that policed the "keep both in sync" rule now point at the
  `declare module` block instead.

- [#523](https://github.com/forinda/kick-js/pull/523) [`6602a5d`](https://github.com/forinda/kick-js/commit/6602a5d69f417cafccc89d04e196b76c50cbe5c5) Thanks [@forinda](https://github.com/forinda)! - Fix the `createTestApp` signature in every generated doc and skill, and install
  the packages those docs depend on.

  The scaffolded AGENTS.md and the `write-controller-test` skill showed
  `createTestApp([UserModule])` followed by `app.get('/…')`. Neither is real:
  the function takes an options object, and the result is
  `{ app, expressApp, container }` with no `.get()`. Following the generated
  instructions threw `this.options.modules is not iterable`, so every scaffolded
  controller test failed before asserting anything — including tests written by
  coding agents, which read these files as their source of truth.

  `defineAugmentation`'s catalogue example passed an object literal for
  `example`, which is typed `string` — a type error in the generated docs.

  The scaffold also told readers to import `@forinda/kickjs-testing` and
  `supertest` without installing either. Both are now in `devDependencies`
  alongside `@types/supertest`.

  A test in `@forinda/kickjs-testing` now pins the documented call shape, so the
  docs and the API cannot drift apart again silently.

  The generated `vitest.config.ts` also lost the `@` path alias that
  `tsconfig.json` and `vite.config.ts` declare. A `vitest.config.ts` overrides
  `vite.config.ts` outright — vitest merges nothing and never reads tsconfig
  `paths` — so any `@/…` import type-checked, built, and ran in dev while
  failing only under test with `Cannot find package '@/…'`.

  It now merges the vite config via `mergeConfig` rather than restating it, so
  the alias, plugins, and ssr externals have exactly one definition instead of
  three that can drift apart.

  Loading the vite config through vitest also surfaced `__dirname`, which does
  not exist under Vite's `configLoader: 'native'` — slated to become the default
  — and warned on every test run. The generated vite config now derives its
  paths from `import.meta.url`, which needs no Node version floor.

  The generated test templates also never imported the env side-effect module.
  `createTestApp` does not load `src/index.ts`, so the `import './config'` that
  registers the extended env schema never ran under test: `ConfigService.get()`
  returned `undefined` while `@Value()` kept working through its `process.env`
  fallback, so the two disagreed only in tests. The templates now import
  `@/config`, and the env-wiring skill gained a test-specific diagnosis step —
  its existing step 1 checks `src/index.ts`, which looks correct in exactly this
  case.

  That skill also showed `loadEnv(envSchema)` with `defineEnv` while the scaffold
  generates `loadEnvFromSchema` with `fromZod`, so anyone following it saw code
  that did not match their project. Both forms are valid; the skill now shows the
  generated one.

  `kick explain` shared the blind spot and now branches on it. Given a
  config-undefined error with test context, it previously returned the
  entry-file diagnosis — "add `import './config'` to src/index.ts" — which is
  already true in that scenario, so the tool pointed at the one file that looked
  correct. It now returns a test-specific diagnosis, and the env-wiring skill
  leads with `kick explain` rather than the manual checklist.

- Updated dependencies [[`68566a3`](https://github.com/forinda/kick-js/commit/68566a3bfb82bd2bb7ceb9230a0a75c040caa886)]:
  - @forinda/kickjs@7.2.0
  - @forinda/kickjs-db@7.2.0

## 6.12.2

### Patch Changes

- Updated dependencies [[`0c7e5e0`](https://github.com/forinda/kick-js/commit/0c7e5e0cff311467dd56fa5c3a02a173e3849b84)]:
  - @forinda/kickjs@7.1.1
  - @forinda/kickjs-db@7.2.0

## 6.12.1

### Patch Changes

- [#517](https://github.com/forinda/kick-js/pull/517) [`2acc2e9`](https://github.com/forinda/kick-js/commit/2acc2e92344a3c25acabbcf1de781478255f62cf) Thanks [@forinda](https://github.com/forinda)! - Generated guards, middleware, and the default error handler stop assuming Express

  Three places emitted or ran Express-only code under a framework that advertises
  a pluggable engine. All three were invisible because the default runtime is
  Express.

  **`kick g middleware`** emitted `import type { Request, Response, NextFunction }
from 'express'`. A Fastify or h3 scaffold has neither `express` nor
  `@types/express` — it installs `fastify` + `@fastify/middie` — so that was a
  compile error on a freshly generated file. Now typed from `node:http`, which is
  what the connect-style handler actually receives on every engine.

  **`kick g guard`** emitted `ctx.res.status(401).json(...)`. `ctx.res` is the
  ENGINE-NATIVE response: `FastifyReply` has no `.json()` (verified against
  Fastify's own types) and h3's event has no `.status()`. Now uses
  `ctx.problem.unauthorized({ detail })` — RFC 9457, engine-neutral, and what the
  error-branch guidance in the controllers guide already teaches.

  **The default `errorHandler()`** read `req.originalUrl`, which only Express
  adds. Fastify and h3 pass `request.raw`, so every error logged
  `GET undefined — <error>`: the path silently dropped from the one line meant to
  identify the failing request. It now falls back to `req.url`, and both it and
  `notFoundHandler()` are typed from node / `RuntimeResponse` rather than Express.

- Updated dependencies [[`b2669ed`](https://github.com/forinda/kick-js/commit/b2669edb63be20f68a55baccd91680e41303b632), [`2acc2e9`](https://github.com/forinda/kick-js/commit/2acc2e92344a3c25acabbcf1de781478255f62cf), [`2f3a453`](https://github.com/forinda/kick-js/commit/2f3a453f1ca40972e202ad6ea6ef612dd505f0f1), [`7d16ebd`](https://github.com/forinda/kick-js/commit/7d16ebd13911c547bcdd86954828c8b640e4ea12), [`d0f62bf`](https://github.com/forinda/kick-js/commit/d0f62bf7ea049f072bbcac77d7042de0f2166784)]:
  - @forinda/kickjs@7.1.0
  - @forinda/kickjs-db@7.2.0

## 6.12.0

### Minor Changes

- [#511](https://github.com/forinda/kick-js/pull/511) [`517b2e4`](https://github.com/forinda/kick-js/commit/517b2e40369827be7bad06a1427baf9ecbef87a4) Thanks [@forinda](https://github.com/forinda)! - Fullstack template: serve the built frontend from the API origin

  `kick new --template fullstack` scaffolds `server/` + `web/` and wires a typed
  dev loop — Vite serves the client and proxies `/api` to the server. But it
  stopped at the deploy boundary: `pnpm build` produced `web/dist` and **nothing
  ever served it**. The generated bootstrap had no adapters, and the root had no
  `start` script — only `vite preview`, which is a dev preview server.

  The generated server now wires `SpaAdapter({ clientDir: '../web/dist' })`, and
  the root gains a `start` script that runs the server. So:

  |            | dev                       | production               |
  | ---------- | ------------------------- | ------------------------ |
  | `web/dist` | absent                    | present                  |
  | SpaAdapter | inert (registers nothing) | serves `/`               |
  | `/api/v1`  | Vite proxy → `:3000`      | controllers, same origin |

  Dev is unchanged: the adapter early-returns while the build directory does not
  exist, which is the normal state under `kick dev`.

  `generateEntryFile` takes an optional `spaClientDir` and composes it with the
  existing swagger / devtools adapter injection rather than replacing it.

### Patch Changes

- Updated dependencies [[`6afe1e2`](https://github.com/forinda/kick-js/commit/6afe1e2b99f9ef40ee2eb3a5bcc4d1e633401a24)]:
  - @forinda/kickjs@7.0.0
  - @forinda/kickjs-db@7.2.0

## 6.11.2

### Patch Changes

- Updated dependencies [[`778573b`](https://github.com/forinda/kick-js/commit/778573b1e2d23debbb5707e3260998f787ec572a), [`d2d4e80`](https://github.com/forinda/kick-js/commit/d2d4e805f13db0dcf296d37e84aaaedce6651b51)]:
  - @forinda/kickjs@6.7.0
  - @forinda/kickjs-db@7.2.0

## 6.11.1

### Patch Changes

- Updated dependencies [[`59941b6`](https://github.com/forinda/kick-js/commit/59941b66c46aa4a228427df18e25f25747dd47c6)]:
  - @forinda/kickjs@6.6.1
  - @forinda/kickjs-db@7.2.0

## 6.11.0

### Minor Changes

- [#505](https://github.com/forinda/kick-js/pull/505) [`55b36cc`](https://github.com/forinda/kick-js/commit/55b36cca66155ef1a743960a6745efb04af04903) Thanks [@forinda](https://github.com/forinda)! - Scaffold `.env.test` in `kick new`, and gitignore `*.local`

  Under a test run KickJS reads `.env.test` instead of `.env` — but that is
  opt-in, and the generator did not produce the file. A scaffolded app therefore
  shipped the exact shape `kick doctor` warns about (a `.env` plus a test runner,
  no `.env.test`), and its first test run printed the backfill warning rather
  than being isolated. The feature never reached anyone who had not read the docs.

  `kick new` now writes a `.env.test` declaring `NODE_ENV=test`, `PORT=0` (ask the
  OS for a free port, so a run cannot collide with a dev server on 3000) and
  `LOG_LEVEL=silent`. Deliberately not a copy of `.env.example`: a var it omits
  goes missing rather than quietly inheriting the developer's value, which is the
  entire point of the short-circuit.

  `.gitignore` gains `*.local`, covering `.env.local` / `.env.test.local`.
  `.env.test` itself stays committed — it is the suite's shared, reviewable
  environment.

  The generated `vitest.config.ts` is unchanged and deliberately has no `env`
  block: vitest's `test.env` sets `process.env` before modules load, which
  outranks every file, so pins there would stop `.env.test` taking effect.

## 6.10.1

### Patch Changes

- Updated dependencies [[`567e234`](https://github.com/forinda/kick-js/commit/567e234d8812678c30ad4c9cc71e130794c5780d)]:
  - @forinda/kickjs@6.6.0
  - @forinda/kickjs-db@7.2.0

## 6.10.0

### Minor Changes

- [#494](https://github.com/forinda/kick-js/pull/494) [`efeba24`](https://github.com/forinda/kick-js/commit/efeba24f6d9764cdf34788e7f15e286121b5c1c4) Thanks [@forinda](https://github.com/forinda)! - fix: generated controllers use return-value handlers, so `KickRoutes[...].response` infers a real type

  `kick typegen` fills `KickRoutes[...].response` with `InferHandlerResponse<Controller['method']>`, which reads the handler's **return type** and nothing else. Every controller the CLI scaffolded wrote its response imperatively, so adopters got no response typing at all — and in one case got worse than nothing:

  | Generated handler          | Old inferred `response`                                                                         |
  | -------------------------- | ----------------------------------------------------------------------------------------------- |
  | `ctx.json(result)`         | `unknown`                                                                                       |
  | `ctx.created(result)`      | `unknown`                                                                                       |
  | `ctx.noContent()`          | `unknown`                                                                                       |
  | `return ctx.notFound(...)` | `RuntimeResponse` — the framework's internal response driver, leaked into the public route type |

  Controllers now return their payload, use `reply.created()` / `reply.noContent()` for non-200 statuses, and route error branches through `ctx.problem.*` (RFC 9457) with a bare `return`, which keeps the 404 out of the success type. `getById` now infers the entity type, `create` the created entity, `remove` `undefined`.

  Affects `kick g module` (rest + minimal patterns), `kick g controller`, `kick g scaffold`, and the `kick g contributor --type http` usage example.

  Also: the minimal pattern now scaffolds the full CRUD surface (`list` / `getById` / `create` / `update` / `remove`) in its single controller file — "minimal" refers to the file count, not the route surface.

  Generated code that already existed is unaffected; this only changes what new scaffolds emit.

### Patch Changes

- Updated dependencies [[`cddc77c`](https://github.com/forinda/kick-js/commit/cddc77c7a4f271ee69676543687c6811085c045f)]:
  - @forinda/kickjs-db@7.2.0

## 6.9.2

### Patch Changes

- [#493](https://github.com/forinda/kick-js/pull/493) [`d7a2b57`](https://github.com/forinda/kick-js/commit/d7a2b57832c9c4271245d2d3f75bfd3b50aff0aa) Thanks [@forinda](https://github.com/forinda)! - fix: scaffolded projects no longer pin every `@forinda/kickjs*` dependency to the CLI's own version

  `kick new` resolves each sibling package's published version with `npm view <pkg> version`, falling back to the CLI's version when the query fails. On Windows that query always failed: `npm` is a `.cmd` batch shim, so `execFileSync('npm', …)` raised `ENOENT` (there is no `npm.exe`) and `npm.cmd` raised `EINVAL` (Node >= 18.20 refuses to spawn batch files without a shell — CVE-2024-27980). The error was swallowed, so every generated `package.json` silently collapsed onto the CLI version — `@forinda/kickjs`, `-schema`, `-vite`, `-swagger` and friends all stamped `^<cli version>` even though per-package independent versioning means they diverge.

  Version resolution now goes through a cross-platform `captureCommand` helper that routes `.cmd` shims via `cmd.exe` on Windows, so each dependency gets its real published range. The same helper fixes `kick new --template fullstack`, whose root `<pm> install` step failed on Windows for the same reason.

## 6.9.1

### Patch Changes

- Updated dependencies [[`6c59d24`](https://github.com/forinda/kick-js/commit/6c59d241dc69206673b656f4c86e1a2a413c9039)]:
  - @forinda/kickjs@6.5.1
  - @forinda/kickjs-db@7.1.1

## 6.9.0

### Minor Changes

- [#487](https://github.com/forinda/kick-js/pull/487) [`0f996b3`](https://github.com/forinda/kick-js/commit/0f996b3a2da3629dd36d58ae1fd1603ff6798981) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds `typescript: ^7.0.2`.

  [TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) (released 2026-07-08) makes `tsc` itself the native Go binary — 8–12× faster full builds, no `@typescript/native-preview` side-install. The generated `tsconfig.json` already used `moduleResolution: 'bundler'` with no `baseUrl`, so it needed no changes; the CLI's generator suite typechecks every scaffolded fixture with `tsc --noEmit` and passes unmodified against 7.0.2.

  **Worth knowing before you upgrade an existing project:** TypeScript 7.0 does not ship a compiler API, so tooling that embeds one — webpack's `ts-loader`, Vue/Astro/Svelte language tooling, `typescript-eslint` — cannot run against it. A stock KickJS project uses none of those (typegen parses with `oxc-parser`).

  If you have added any, there are three options and none of them is urgent:

  - Stay on `typescript@6`. It remains supported; this is a steady state, not a stopgap.
  - Install [`@typescript/typescript6`](https://www.npmjs.com/package/@typescript/typescript6) alongside 7 and point that tooling at the `tsc6` binary it provides, so the rest of your build gets the native compiler.
  - Wait for the new API, which the TypeScript team expects to ship in 7.1.

  Nothing forces the upgrade either way — set the version back in your own `package.json` and everything still works.

## 6.8.0

### Minor Changes

- [#483](https://github.com/forinda/kick-js/pull/483) [`65ba513`](https://github.com/forinda/kick-js/commit/65ba51330706f058e50d3ce6b2fa9f85e8971518) Thanks [@forinda](https://github.com/forinda)! - Resolve app-level `contributors: [...]` for per-route context-key narrowing.

  A `bootstrap({ contributors })` registration previously degraded the whole project — narrowing switched off everywhere. It's now resolved and its keys union into every route, since app-level contributors apply to all of them and need no attribution. `createWebApp()` and `new Application()` take the same `ApplicationOptions` and are handled identically.

  ```ts
  export const app = bootstrap({
    modules,
    contributors: [LoadTenant.registration],
  });
  ```

  Every route in the app now narrows to include `'tenant'`, and `ctx.require('somethingElse')` is a compile error.

  Note the shape difference this had to accommodate: `ApplicationOptions.contributors` is an **array** (`ContributorRegistrations`) where `AppModule.contributors` is a **hook** (`(): ContributorRegistrations`). The extractor accepts both.

  The entry point must be **imported from `@forinda/kickjs`** to be recognised. If you wrap bootstrap in your own function (`import { bootstrap } from './my-bootstrap'`) or call it off a namespace import (`kick.bootstrap({...})`), typegen won't classify it as an app-entry site and the project degrades to unnarrowed — the safe direction. Matching on the bare name instead would union whatever a same-named local function called `contributors` into every route's key set, asserting keys that may not exist.

  **Adapter and plugin `contributors()` still degrade the project.** Their bodies ship from packages typegen can't read, so the keys they add to every route are unknowable. A first-party `defineAdapter` in the adopter's own `src/` is in principle resolvable, but `defineAdapter` exposes `contributors()` from its `build()` return rather than the options top level, and an adapter imported from `node_modules` is indistinguishable at the point of use — resolving only the local case would narrow some projects and not others for reasons invisible in the source. Left out deliberately.

  With this, four of the five registration sites resolve: method decorator, class decorator, module hook, and bootstrap option. Degradation still applies for an unrecognised decorator, an unresolvable import, an ambiguous name, a registration list that isn't a literal array of `X.registration` / `X.with(…).registration` entries, and a controller mounted by two modules.

- [#482](https://github.com/forinda/kick-js/pull/482) [`421017c`](https://github.com/forinda/kick-js/commit/421017ce4f7911aba639551f1fbe2d502c2ee284) Thanks [@forinda](https://github.com/forinda)! - Resolve module-level `contributors()` for per-route context-key narrowing.

  A module's `contributors()` hook previously degraded the **entire project**: the scanner detected the word `contributors` anywhere and disabled narrowing everywhere, so any project using module-scoped contributors got no benefit from the feature at all. The hook is now attributed to the controllers that module mounts — it and the mounts live on the same module object, so they share a file — and its keys union into those routes exactly as a class-level decorator's would.

  ```ts
  export const AuditModule = defineModule({
    name: "Audit",
    build: () => ({
      routes: () => ({ path: "/audit", controller: AuditController }),
      contributors: () => [LoadTenant.registration],
    }),
  });
  ```

  Routes on `AuditController` now narrow to `'tenant'` with no decorator on the controller at all — and `ctx.require('somethingElse')` on them is a compile error.

  Both registration forms are resolved (`X.registration` and `X.with({…}).registration`), in both the `defineModule` object form and the `class X implements AppModule` form.

  **Adapter and bootstrap registrations still degrade the project.** They apply app-wide and can't be attributed to any particular route. The classifier isn't a heuristic: `AppModule` declares `contributors?()` and `routes()` as siblings, so a `contributors` member alongside a `routes` member is the module hook, and `bootstrap({ contributors })` / `defineAdapter({ contributors })` / `definePlugin({ contributors })` — which have no sibling `routes` — are not.

  Module resolution itself degrades rather than reporting a partial set when the hook isn't a literal array of registration entries (a spread, a helper call, a variable holding the array), or when a controller is mounted by two modules — there, which contributor set applied depends on which mount served the request.

- [#481](https://github.com/forinda/kick-js/pull/481) [`5667c4b`](https://github.com/forinda/kick-js/commit/5667c4b1f5e95c16a414c9262a9b420bdfb0b27b) Thanks [@forinda](https://github.com/forinda)! - Per-route context-key narrowing — a dropped contributor decorator is now a compile error.

  `kick typegen` emits a `contextKeys` union per route from the context decorators applied at method and class level, and `ctx.require()` is narrowed to it. Removing a decorator removes the key:

  ```text
  error TS2345: Argument of type '"operatorPerm"' is not assignable to parameter of type '"tenant"'.
  ```

  That refactor was previously invisible to `tsc` — `ctx.get('operatorPerm')!` compiled whether or not the decorator was applied, and the handler read `undefined` into an authorization check.

  **`ctx.get()` is deliberately not narrowed.** The original design (`architecture.md` §20.14) proposed dropping `| undefined` from `get()` for keys typegen believes are present. That was not built, because the two options fail in opposite directions: narrowing `get()` wrongly produces a value the types promise and the runtime doesn't deliver — silent, fails open, the exact failure this line of work removed. Narrowing `require()` wrongly produces a compile error — loud, fails closed, and covered by an escape hatch.

  **Narrowing applies only where completeness is provable.** A route gets a key union only when every decorator on it is either a known contributor-free framework decorator or a resolvable context decorator. Typegen emits `string` (no narrowing, today's behaviour) for an unrecognised decorator — adopter decorators can bundle contributors of their own — an unresolvable import, an ambiguous binding name, a route recovered by the regex fallback, or the presence of **any** contributor registered at module / adapter / bootstrap level, since a global registration adds keys to routes that carry no decorator for them. `never` is distinct from `string`: it means the scanner proved the route carries no contributors, so `require()` on it really is a mistake.

  **Escape hatch:** type the handler as plain `RequestContext` rather than `Ctx<KickRoutes…>` — `TKeys` defaults to `string` and no narrowing applies.

  API changes, both source-compatible: `RequestContext` gains a fourth type parameter `TKeys extends string = string`, and `ExecutionContext` becomes `ExecutionContext<TKeys extends string = string>`. Existing annotations keep working — the defaults reproduce today's behaviour exactly. `RouteShape` gains an optional `contextKeys` member.

  Module, adapter, and bootstrap registration sites are detected but not yet resolved; resolving them (so a module-scoped contributor narrows instead of degrading the project) is the next increment.

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

- Updated dependencies [[`139c5dd`](https://github.com/forinda/kick-js/commit/139c5dd94346ca2e65d32ad5b2e366cbeae7e6c6), [`1ebcd00`](https://github.com/forinda/kick-js/commit/1ebcd000d84d8514b06cf1633ceccbbff4678c85), [`5667c4b`](https://github.com/forinda/kick-js/commit/5667c4b1f5e95c16a414c9262a9b420bdfb0b27b)]:
  - @forinda/kickjs@6.5.0
  - @forinda/kickjs-db@7.1.1

## 6.7.0

### Minor Changes

- [#469](https://github.com/forinda/kick-js/pull/469) [`f721f83`](https://github.com/forinda/kick-js/commit/f721f83a457044ce3800e24d9a598e3b5dfe8676) Thanks [@forinda](https://github.com/forinda)! - feat: tRPC-style RPC sugar — `createRpc(api, kickRpc)`

  ```ts
  import { kickRpc } from "./.kickjs/types/kick__routes";

  const rpc = createRpc(api, kickRpc);
  const task = await rpc.tasks.get({ params: { id: "42" } }); // typed end to end
  ```

  - `kick typegen` now also emits a runtime `kickRpc` manifest in
    `kick__routes.ts` (`controller.method → 'VERB /mounted/path'`, friendly
    namespaces: `TasksController` → `tasks`; stays in lockstep with the
    `KickRoutes.Api` map incl. duplicate handling)
  - `createRpc` builds a plain typed namespace over the existing client — no
    Proxy, no new inference; required params/body enforced, SSE routes typed
    `never` (use `api.stream`)

### Patch Changes

- Updated dependencies [[`dc60f42`](https://github.com/forinda/kick-js/commit/dc60f420299c961a83d9b7df6ea32b12de80afc8), [`7f3e2aa`](https://github.com/forinda/kick-js/commit/7f3e2aa8579813bc5e427a1bd18c27e8075c4030)]:
  - @forinda/kickjs@6.4.0
  - @forinda/kickjs-db@7.1.1

## 6.6.1

### Patch Changes

- Updated dependencies [[`a2bfaa8`](https://github.com/forinda/kick-js/commit/a2bfaa87657654bacfe3ab92a55bf9978d3d4a40)]:
  - @forinda/kickjs@6.3.1
  - @forinda/kickjs-db@7.1.1

## 6.6.0

### Minor Changes

- [#463](https://github.com/forinda/kick-js/pull/463) [`58c0afe`](https://github.com/forinda/kick-js/commit/58c0afe8f134797b26fe70a077fad1973d8a46df) Thanks [@forinda](https://github.com/forinda)! - feat: fullstack-aware agent docs + modernized generated guidance

  - `kick g agents` / `kick new` accept `fullstack`: the workspace root gets
    CLAUDE.md + `.agents/` with a "Fullstack workspace layout" section (the
    server/web type loop and its do-not-break rules)
  - Generated AGENTS.md guidance now teaches return-value handlers +
    `reply()`, declared `{ response: schema }` contracts, the typed client,
    and the `@PostConstruct`/`@PreDestroy` lifecycle pair; the skills
    controller sample returns `reply(201, ...)`
  - Dead `ddd`/`cqrs` template labels removed; the ~100-line unused legacy
    CLAUDE template remnant deleted (its comment invited removal)

- [#457](https://github.com/forinda/kick-js/pull/457) [`d08c1b9`](https://github.com/forinda/kick-js/commit/d08c1b917dadc8d4287104c5c2d8f43e5844a5ed) Thanks [@forinda](https://github.com/forinda)! - feat: declared response schemas — one declaration feeds Swagger AND the typed client

  ```ts
  @Get('/', { response: taskSchema })
  list() { return this.tasks.all() }
  ```

  - `RouteDefinition.validation.response` (`@forinda/kickjs`): a declared,
    never-runtime-validated response contract
  - `@forinda/kickjs-swagger`: the schema documents the auto-generated success
    response (`200`/`201`) as `application/json` content in
    `components/schemas`; explicit `@ApiResponse` entries still win; `204`
    defaults stay body-less
  - `kick typegen`: a declared `response` schema overrides return-type inference
    for that route in `KickRoutes[...].response` (both scan paths)

  Docs, server types, and the typed client now share one source of truth per route.

- [#465](https://github.com/forinda/kick-js/pull/465) [`0313b95`](https://github.com/forinda/kick-js/commit/0313b9576de7fd15ebc6467cfdbb210f19b3fee1) Thanks [@forinda](https://github.com/forinda)! - feat: typed SSE end to end + the `KickApi` alias

  ```ts
  // server — ctx.sse is now generic; `return sse` carries the event type
  const sse = ctx.sse<{ n: number }>();
  sse.send({ n: 1 }); // typed
  return sse;

  // client — only SSE routes accepted; events typed
  const stream = await api.stream("/events");
  for await (const ev of stream) ev.data; // { n: number }
  ```

  - `@forinda/kickjs`: `SseHandler<T>` (phantom `__sse` marker — structural
    detection, no server imports needed client-side)
  - `@forinda/kickjs-client`: `api.stream()` — fetch-based SSE parser (works
    with injected fetch/`createTestClient`), `SseEvent<T>` with JSON-parsed
    data + `event`/`id`, `close()` aborts; also STRICTER options: omitting a
    required `params`/`body` argument is now a compile error (was a runtime
    throw)
  - `kick typegen` emits a global `KickApi` alias for `KickRoutes.Api` —
    `createClient<KickApi>` everywhere

### Patch Changes

- Updated dependencies [[`f4e0b10`](https://github.com/forinda/kick-js/commit/f4e0b105d91303a53ada7b7cc4a83cd386a0b1a4), [`d08c1b9`](https://github.com/forinda/kick-js/commit/d08c1b917dadc8d4287104c5c2d8f43e5844a5ed), [`0313b95`](https://github.com/forinda/kick-js/commit/0313b9576de7fd15ebc6467cfdbb210f19b3fee1)]:
  - @forinda/kickjs@6.3.0
  - @forinda/kickjs-db@7.1.1

## 6.5.0

### Minor Changes

- [#452](https://github.com/forinda/kick-js/pull/452) [`50e40e9`](https://github.com/forinda/kick-js/commit/50e40e9f491084b39e47b778aa5fec221c0e083e) Thanks [@forinda](https://github.com/forinda)! - feat: `kick new --template fullstack` — typed end-to-end workspace

  Scaffolds a pnpm workspace with `server/` (KickJS API) and `web/` (Vite +
  React) where the frontend is typed against the backend via
  `@forinda/kickjs-client` and the server's generated `KickRoutes.Api`:

  ```bash
  kick new my-app --template fullstack
  cd my-app && pnpm dev   # server (kick dev) + web (vite), proxied
  ```

  Rename a field in a server handler → the web app stops compiling.

  Also, found by proving the template end-to-end:

  - `@forinda/kickjs-client`: package exports pointed at `dist/index.mjs` /
    `.d.mts` but the build emits `index.js` / `.d.ts` — the published entry was
    unresolvable; fixed
  - `@forinda/kickjs-client`: the generated `KickRoutes.Api` is an interface
    (no index signature) and failed the client's `Record` constraint — the
    generic now accepts it
  - the scaffolded hello controller uses return-value handlers, so its response
    types flow into the typed client out of the box

## 6.4.0

### Minor Changes

- [#445](https://github.com/forinda/kick-js/pull/445) [`bc6db15`](https://github.com/forinda/kick-js/commit/bc6db15edbaf938844ebd9d2595e559c020eea43) Thanks [@forinda](https://github.com/forinda)! - feat: response type inference — `KickRoutes[...].response` is now real

  `kick typegen` emits each route's `response` as a type reference to the
  controller handler itself:

  ```ts
  response: import("@forinda/kickjs").InferHandlerResponse<_C0["get"]>;
  ```

  Your tsc computes the actual type — the scanner stays checker-free and
  watch-fast. Return-value handlers yield their exact payload
  (`Reply<201, Task>` unwraps to `Task`); imperative `ctx.json` handlers
  degrade to `unknown` exactly as before.

  - `@forinda/kickjs`: new `InferHandlerResponse<H>` type (exported from the
    root, `/web`, and the http barrel)
  - `@forinda/kickjs-cli`: hoisted controller `import type` per (file, class),
    default-export controllers use a `default as` binding;
    `DiscoveredRoute.controllerIsDefaultExport` on both scan paths (AST + regex)

- [#446](https://github.com/forinda/kick-js/pull/446) [`033bae4`](https://github.com/forinda/kick-js/commit/033bae41b2411a20a08363214ff47e0ed3899f57) Thanks [@forinda](https://github.com/forinda)! - feat: `@forinda/kickjs-client` — typed fetch client (R3, closes the response-inference roadmap)

  `kick typegen` now also emits a flat `KickRoutes.Api` map (`'GET /tasks/:id'`
  keys referencing the controller route shapes). The new zero-dependency client
  consumes it:

  ```ts
  import { createClient } from "@forinda/kickjs-client";

  const api = createClient<KickRoutes.Api>({ baseUrl: "https://x/api/v1" });
  const task = await api.get("/tasks/:id", { params: { id: "42" } });
  //    ^ your handler's actual return type
  ```

  - Paths, params and body constrained per verb at compile time; responses flow
    from return-value handlers via `InferHandlerResponse`
  - Runtime-neutral (fetch/URL/Headers) — browsers, node, Bun, Deno, edge
  - `KickClientError` carries status + parsed RFC 9457 problem body
  - Injectable `fetch` — pass `createWebApp().fetch` for network-free tests

### Patch Changes

- [#448](https://github.com/forinda/kick-js/pull/448) [`d64041d`](https://github.com/forinda/kick-js/commit/d64041dfe997a2060f5a2515ae5fa1dcac472626) Thanks [@forinda](https://github.com/forinda)! - fix: `KickRoutes.Api` keys are now module-mount-joined paths

  The flat client map keyed on the bare decorator path (`'GET /:id'`) instead of
  the mounted path (`'GET /tasks/:id'`) — every mounted controller's typed calls
  404'd, and multi-resource apps collided on `/:id`-style keys with routes
  silently dropped. Fixed by threading `DiscoveredRoute.mountedPath` through both
  scan paths (AST + regex, parity preserved).

  Also from the same review pass:

  - fresh projects with zero routes now still emit an empty `KickRoutes.Api`, so
    `createClient<KickRoutes.Api>` compiles before the first controller exists
  - a controller class named `Api` now triggers a typegen warning (it would
    declaration-merge into the reserved flat map)
  - duplicate-route warnings now say what they mean (a genuine runtime verb+path
    conflict) instead of firing false positives across controllers
  - client: `ShapeOf` fallback is `never` (was all-`unknown`) — generator/client
    key drift fails loudly at the call site instead of silently untyping calls
  - kickjs: `KickRoutes` doc comment updated for the `Api` member + the actual
    generated filename

- Updated dependencies [[`d64041d`](https://github.com/forinda/kick-js/commit/d64041dfe997a2060f5a2515ae5fa1dcac472626), [`860b2d1`](https://github.com/forinda/kick-js/commit/860b2d1fe49fd6c0f94d6f69b6e096878bfb0366), [`ff3e492`](https://github.com/forinda/kick-js/commit/ff3e492bb3261102be774d44730d878399417a46), [`822490f`](https://github.com/forinda/kick-js/commit/822490f293b7616440c5c8c68476daf93d643735), [`7812f43`](https://github.com/forinda/kick-js/commit/7812f437cc3d0fcff09dbba90850360b298e6b1a), [`bc6db15`](https://github.com/forinda/kick-js/commit/bc6db15edbaf938844ebd9d2595e559c020eea43), [`da37fcf`](https://github.com/forinda/kick-js/commit/da37fcf96cd71be68f6aa34f8e08be1f5663201a)]:
  - @forinda/kickjs@6.2.0
  - @forinda/kickjs-db@7.1.1

## 6.3.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

- Updated dependencies [[`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783)]:
  - @forinda/kickjs@6.1.1
  - @forinda/kickjs-cli-kit@0.1.2
  - @forinda/kickjs-db@7.1.1

## 6.3.0

### Minor Changes

- [#425](https://github.com/forinda/kick-js/pull/425) [`d248935`](https://github.com/forinda/kick-js/commit/d248935243ec882085b533d05d1969d85920903e) Thanks [@forinda](https://github.com/forinda)! - typegen: resolve decorated classes at any module depth + `kick typegen --fix`

  Decorated classes (`@Controller`, `@Service`, …) only register at runtime if a
  module's `import.meta.glob([...], { eager: true })` imports their file. When you
  reorganise a module into sub-folders (e.g. moving controllers into
  `controllers/`), a shallow glob stops reaching them — routes silently vanish and
  DI tokens resolve `undefined`. Typegen already detected this; now it helps fix it:

  - **Actionable warning** — orphaned classes are grouped by their owning module
    file, with the exact recursive glob to add (`./**/*.controller.ts`) and a
    `kick typegen --fix` hint.
  - **`kick typegen --fix`** — patches each module's `import.meta.glob(...)` call in
    place (array or bare-string form), adding the missing recursive patterns.
    Idempotent; skips patterns already present.
  - **Scaffold templates** now emit recursive globs that include controllers, so
    newly-generated modules don't orphan when reorganised.

## 6.2.3

### Patch Changes

- Updated dependencies [[`3d877a9`](https://github.com/forinda/kick-js/commit/3d877a9cfb2ff7bea4d1fc965bd62c184ba3a957), [`2c705d7`](https://github.com/forinda/kick-js/commit/2c705d72a8741f46034ff178cec7625969811271), [`8bbf484`](https://github.com/forinda/kick-js/commit/8bbf484d0cbd1fb0abf5a55d21873bef41231e95), [`7864609`](https://github.com/forinda/kick-js/commit/786460934ac035a3d591d7b80d49cdfba6a64a1d)]:
  - @forinda/kickjs@6.1.0
  - @forinda/kickjs-db@7.1.0

## 6.2.2

### Patch Changes

- Updated dependencies [[`732d0f6`](https://github.com/forinda/kick-js/commit/732d0f64d8e5082b6fe8564a73ed1e8daf2c346b)]:
  - @forinda/kickjs@6.0.1
  - @forinda/kickjs-db@7.0.0

## 6.2.1

### Patch Changes

- [#402](https://github.com/forinda/kick-js/pull/402) [`f45f83c`](https://github.com/forinda/kick-js/commit/f45f83c362de15cd7f396814b0eb191a96c6c750) Thanks [@forinda](https://github.com/forinda)! - The post-scaffold "Available:" hint no longer advertises deprecated packages. It was a hardcoded list that included `auth`, `drizzle`, and `prisma` (all deprecated); it's now derived from `PACKAGE_REGISTRY`, filtering out deprecated, core, `:` sub-variants, and db-dialect/schema-lib duplicates — so it can't drift. A test locks it (no deprecated/core names in the list).

- Updated dependencies [[`506f083`](https://github.com/forinda/kick-js/commit/506f083df779256a4f366a936e918da7e43a592b), [`f45f83c`](https://github.com/forinda/kick-js/commit/f45f83c362de15cd7f396814b0eb191a96c6c750)]:
  - @forinda/kickjs@6.0.0
  - @forinda/kickjs-db@7.0.0

## 6.2.0

### Minor Changes

- [#391](https://github.com/forinda/kick-js/pull/391) [`3a3080c`](https://github.com/forinda/kick-js/commit/3a3080c26fca405ad3f3bd34d79a30f1a1b712dd) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds the HTTP runtime explicitly. A new `--runtime express|fastify|h3` flag (and interactive prompt, default `express`) controls:

  - the generated `src/index.ts` — `bootstrap({ runtime: expressRuntime() })` / `fastifyRuntime()` / `h3Runtime()`, imported from the core package (Express) or the `@forinda/kickjs/fastify` / `@forinda/kickjs/h3` subpath;
  - the installed engine peers — Fastify adds `fastify` + `@fastify/middie`, h3 adds `h3` (Express needs nothing extra);
  - the REST template's middleware — `express.json()` is only emitted for Express, since Fastify and h3 parse bodies natively (adding it would consume the body stream twice).

  Making the runtime explicit means switching engines later is a one-line edit, and the scaffold installs exactly the deps the chosen engine needs.

- [#395](https://github.com/forinda/kick-js/pull/395) [`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea) Thanks [@forinda](https://github.com/forinda)! - File uploads (`@FileUpload` → `ctx.file` / `ctx.files`) now work on all three runtimes, and the CLI grew runtime-aware tooling around them.

  **`@forinda/kickjs`**

  - Fastify and h3 runtimes implement file uploads (previously gated `capabilities.uploads: false`). Fastify buffers multipart parts via `@fastify/multipart` (new optional peer); h3 uses its built-in `readMultipartFormData`. Both produce the same Multer-shaped file objects as Express, so `@FileUpload` and `ctx.file` / `ctx.files` behave identically across engines. Conformance-tested under all three.
  - New shared helpers in `middleware/upload.ts`: `buildFileTypeFilter`, `applyUploadConfig` (enforces field name, type filter, per-file `maxSize`, array `maxCount`).
  - Added `HttpStatus.PAYLOAD_TOO_LARGE` (413) and `HttpStatus.UNSUPPORTED_MEDIA_TYPE` (415).
  - The runtime subpaths export their engine-native type maps: `FastifyRuntimeTypes` (`@forinda/kickjs/fastify`) and `H3RuntimeTypes` (`@forinda/kickjs/h3`), for the `KickRuntimeRegister` escape-hatch augmentation.

  **`@forinda/kickjs-cli`**

  - `KickConfig.runtime?: 'express' | 'fastify' | 'h3'` — written by `kick new --runtime`, read by dep-aware commands.
  - `kick add upload` installs the multipart driver for the project's runtime: Express → `multer` (+ `@types/multer`), Fastify → `@fastify/multipart`, h3 → none (native).
  - New `kick/runtime` typegen plugin emits the `KickRuntimeRegister` augmentation from `config.runtime`, retyping `ctx.req` / `ctx.res` / `AdapterContext.app` / `getRuntimeApp()` to the active engine (Express stays the default, no augmentation emitted).
  - `kick doctor` gains two checks: the configured runtime's engine peers are installed, and — when upload usage is detected in `src/` — the matching multipart driver is present.

### Patch Changes

- [#399](https://github.com/forinda/kick-js/pull/399) [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f) Thanks [@forinda](https://github.com/forinda)! - The Fastify and h3 runtimes no longer depend on `express`. Their `serveStatic` used `express.static`, which forced `express` to be installed even on a pure Fastify/h3 app — defeating the point of swapping the engine. They now use `serve-static` (the standalone connect middleware that `express.static` wraps), bridged through middie / `fromNodeMiddleware` exactly as before. `serve-static` is a new optional peer of `@forinda/kickjs`.

  CLI scaffolding follows suit: `kick new --runtime fastify|h3` now installs `serve-static` instead of `express` (and drops the `@types/express` devDependency) — an Express scaffold still gets `express`. The alpha-channel pins for the runtime toolchain (`@forinda/kickjs`, `-cli`, `-vite`) are now `^`-ranges rather than exact versions, so a generated project floats to newer alphas and auto-graduates to the stable release once it ships.

- [#397](https://github.com/forinda/kick-js/pull/397) [`0606f9b`](https://github.com/forinda/kick-js/commit/0606f9bbf83d449eaf81b53f7f27782b6f33f531) Thanks [@forinda](https://github.com/forinda)! - Fix `kick new --runtime fastify|h3` installing a `@forinda/kickjs` that lacks the engine subpath. The Fastify / h3 runtimes ship on the `alpha` channel for now, but the scaffolder resolved `@forinda/kickjs` from the `latest` dist-tag — so a generated Fastify/h3 app pinned a stable kickjs without the `./fastify` / `./h3` exports and failed to boot under Vite (`"./h3" is not exported …`). The scaffolder now pins `@forinda/kickjs` to the `alpha` channel (exact prerelease version) when a non-Express runtime is chosen, and warns with a manual `add @forinda/kickjs@alpha` hint if the alpha can't be resolved. Express scaffolds stay on the stable channel.

  Also refreshed the generated agent docs (`AGENTS.md` / `CLAUDE.md` / README templates) to describe KickJS as engine-pluggable (Express / Fastify / h3) instead of Express-only, with an explicit "don't assume Express" section, the `runtime` config field, cross-engine uploads, and `kick add upload` / `kick doctor` — so coding agents don't hallucinate an Express-only framework.

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78), [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f)]:
  - @forinda/kickjs@5.18.0
  - @forinda/kickjs-db@7.0.0

## 6.2.0-alpha.2

### Patch Changes

- [#399](https://github.com/forinda/kick-js/pull/399) [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f) Thanks [@forinda](https://github.com/forinda)! - The Fastify and h3 runtimes no longer depend on `express`. Their `serveStatic` used `express.static`, which forced `express` to be installed even on a pure Fastify/h3 app — defeating the point of swapping the engine. They now use `serve-static` (the standalone connect middleware that `express.static` wraps), bridged through middie / `fromNodeMiddleware` exactly as before. `serve-static` is a new optional peer of `@forinda/kickjs`.

  CLI scaffolding follows suit: `kick new --runtime fastify|h3` now installs `serve-static` instead of `express` (and drops the `@types/express` devDependency) — an Express scaffold still gets `express`. The alpha-channel pins for the runtime toolchain (`@forinda/kickjs`, `-cli`, `-vite`) are now `^`-ranges rather than exact versions, so a generated project floats to newer alphas and auto-graduates to the stable release once it ships.

- Updated dependencies [[`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f)]:
  - @forinda/kickjs@5.18.0-alpha.1
  - @forinda/kickjs-db@7.0.0-alpha.0

## 6.2.0-alpha.1

### Patch Changes

- [#397](https://github.com/forinda/kick-js/pull/397) [`0606f9b`](https://github.com/forinda/kick-js/commit/0606f9bbf83d449eaf81b53f7f27782b6f33f531) Thanks [@forinda](https://github.com/forinda)! - Fix `kick new --runtime fastify|h3` installing a `@forinda/kickjs` that lacks the engine subpath. The Fastify / h3 runtimes ship on the `alpha` channel for now, but the scaffolder resolved `@forinda/kickjs` from the `latest` dist-tag — so a generated Fastify/h3 app pinned a stable kickjs without the `./fastify` / `./h3` exports and failed to boot under Vite (`"./h3" is not exported …`). The scaffolder now pins `@forinda/kickjs` to the `alpha` channel (exact prerelease version) when a non-Express runtime is chosen, and warns with a manual `add @forinda/kickjs@alpha` hint if the alpha can't be resolved. Express scaffolds stay on the stable channel.

  Also refreshed the generated agent docs (`AGENTS.md` / `CLAUDE.md` / README templates) to describe KickJS as engine-pluggable (Express / Fastify / h3) instead of Express-only, with an explicit "don't assume Express" section, the `runtime` config field, cross-engine uploads, and `kick add upload` / `kick doctor` — so coding agents don't hallucinate an Express-only framework.

## 6.2.0-alpha.0

### Minor Changes

- [#391](https://github.com/forinda/kick-js/pull/391) [`3a3080c`](https://github.com/forinda/kick-js/commit/3a3080c26fca405ad3f3bd34d79a30f1a1b712dd) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds the HTTP runtime explicitly. A new `--runtime express|fastify|h3` flag (and interactive prompt, default `express`) controls:

  - the generated `src/index.ts` — `bootstrap({ runtime: expressRuntime() })` / `fastifyRuntime()` / `h3Runtime()`, imported from the core package (Express) or the `@forinda/kickjs/fastify` / `@forinda/kickjs/h3` subpath;
  - the installed engine peers — Fastify adds `fastify` + `@fastify/middie`, h3 adds `h3` (Express needs nothing extra);
  - the REST template's middleware — `express.json()` is only emitted for Express, since Fastify and h3 parse bodies natively (adding it would consume the body stream twice).

  Making the runtime explicit means switching engines later is a one-line edit, and the scaffold installs exactly the deps the chosen engine needs.

- [#395](https://github.com/forinda/kick-js/pull/395) [`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea) Thanks [@forinda](https://github.com/forinda)! - File uploads (`@FileUpload` → `ctx.file` / `ctx.files`) now work on all three runtimes, and the CLI grew runtime-aware tooling around them.

  **`@forinda/kickjs`**

  - Fastify and h3 runtimes implement file uploads (previously gated `capabilities.uploads: false`). Fastify buffers multipart parts via `@fastify/multipart` (new optional peer); h3 uses its built-in `readMultipartFormData`. Both produce the same Multer-shaped file objects as Express, so `@FileUpload` and `ctx.file` / `ctx.files` behave identically across engines. Conformance-tested under all three.
  - New shared helpers in `middleware/upload.ts`: `buildFileTypeFilter`, `applyUploadConfig` (enforces field name, type filter, per-file `maxSize`, array `maxCount`).
  - Added `HttpStatus.PAYLOAD_TOO_LARGE` (413) and `HttpStatus.UNSUPPORTED_MEDIA_TYPE` (415).
  - The runtime subpaths export their engine-native type maps: `FastifyRuntimeTypes` (`@forinda/kickjs/fastify`) and `H3RuntimeTypes` (`@forinda/kickjs/h3`), for the `KickRuntimeRegister` escape-hatch augmentation.

  **`@forinda/kickjs-cli`**

  - `KickConfig.runtime?: 'express' | 'fastify' | 'h3'` — written by `kick new --runtime`, read by dep-aware commands.
  - `kick add upload` installs the multipart driver for the project's runtime: Express → `multer` (+ `@types/multer`), Fastify → `@fastify/multipart`, h3 → none (native).
  - New `kick/runtime` typegen plugin emits the `KickRuntimeRegister` augmentation from `config.runtime`, retyping `ctx.req` / `ctx.res` / `AdapterContext.app` / `getRuntimeApp()` to the active engine (Express stays the default, no augmentation emitted).
  - `kick doctor` gains two checks: the configured runtime's engine peers are installed, and — when upload usage is detected in `src/` — the matching multipart driver is present.

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0
  - @forinda/kickjs-db@7.0.0-alpha.0

## 6.1.1

### Patch Changes

- [#364](https://github.com/forinda/kick-js/pull/364) [`db882ca`](https://github.com/forinda/kick-js/commit/db882cab2fe971813db11145780584346a0cbc67) Thanks [@forinda](https://github.com/forinda)! - `kick typegen --no-cache` disables the persistent per-file scan cache, re-reading and re-extracting every source file from cold. Escape hatch for the rare `mtimeMs:size` signature collision (a file edited fast enough that its mtime + size are unchanged) where the cache would otherwise serve a stale extract — previously the only recovery was manually deleting `.kickjs/cache`. `runTypegen({ noCache: true })` exposes the same on the programmatic API.

- [#368](https://github.com/forinda/kick-js/pull/368) [`eb4297f`](https://github.com/forinda/kick-js/commit/eb4297fdbc326415ae27b07d8564fb64dbe41753) Thanks [@forinda](https://github.com/forinda)! - `kick add ws` now installs the correct peer dependency. The catalog listed `socket.io`, but `@forinda/kickjs-ws` is built on the `ws` package (`WebSocketServer`) — adopters running `kick add ws` got the wrong library. Fixed the registry entry to `ws`.

- Updated dependencies [[`191935b`](https://github.com/forinda/kick-js/commit/191935bdfe0f8f41ba829ce335ff43536d5cd3a6), [`7e3cbf2`](https://github.com/forinda/kick-js/commit/7e3cbf2d3e1f23b0648f3cb912ccf79cd2b59cec), [`b11a837`](https://github.com/forinda/kick-js/commit/b11a83773e84299e52fbb1b74533b3986972a3bc)]:
  - @forinda/kickjs-db@6.3.0
  - @forinda/kickjs@5.17.0

## 6.1.0

### Minor Changes

- [#348](https://github.com/forinda/kick-js/pull/348) [`134482b`](https://github.com/forinda/kick-js/commit/134482b9ae737d628344f7af9d5b7155e99fadc7) Thanks [@forinda](https://github.com/forinda)! - Refresh the `kick add` catalog. `ai` (`@forinda/kickjs-ai` + zod) and `auth` (`@forinda/kickjs-auth` + jsonwebtoken) are now resolvable — `kick add auth` previously reported "Unknown packages" despite the help text suggesting it. Deprecated entries (`auth` → BYO auth via context contributors, `drizzle`/`prisma` → `@forinda/kickjs-db`) still install but print a migration warning and are flagged in `kick add --list --all`. Catalog resolution is exposed as a pure `planAddPackages()` helper with a drift-guard test that fails if an entry stops matching a published workspace package.

- [#353](https://github.com/forinda/kick-js/pull/353) [`d14d671`](https://github.com/forinda/kick-js/commit/d14d671781e61fab02cc5b05cfff2d2b7044f417) Thanks [@forinda](https://github.com/forinda)! - `kick typegen` per-file extraction is now AST-based (oxc-parser) with the regex extractors kept as a fallback for unparseable mid-edit sources. Accuracy fixes over the regex path: template-literal route paths extract correctly, `@ApiQueryParams` stacked above the HTTP decorator is no longer silently dropped, string literals containing parens/braces can't skew extraction, aliased named imports resolve as schema sources, and const-bound `createToken` declarations are no longer double-emitted. The scan cache version is bumped so stale regex-era entries refresh on first run.

- [#352](https://github.com/forinda/kick-js/pull/352) [`afda925`](https://github.com/forinda/kick-js/commit/afda9253c5e5eb1e8c0dfa668e57d1272c8cc22c) Thanks [@forinda](https://github.com/forinda)! - `kick dev --typecheck` (or `dev.typecheck: true` in kick.config) runs the project's own TypeScript checker after each debounced change and surfaces diagnostics without leaving the dev console. Resolves `tsgo` (`@typescript/native-preview`) from the project's `node_modules/.bin`, falling back to `tsc`; runs `--noEmit` after the typegen pass settles so checks always see fresh `.kickjs/types`. In-flight runs are killed when a new save lands. Failures print a capped diagnostic summary and broadcast a `kickjs:typecheck` HMR event with the full output; a healthy project stays quiet, and the first clean run after an error prints a "clean again" line. Off by default.

- [#348](https://github.com/forinda/kick-js/pull/348) [`630c07d`](https://github.com/forinda/kick-js/commit/630c07d6da38bcbe4b2aae5c3ad55a71e5ca2788) Thanks [@forinda](https://github.com/forinda)! - `kick typegen` now warns when a route decorator's wired `body`/`query`/`params` schema cannot be statically resolved and the generated `KickRoutes` type silently falls back to `unknown` (or URL-pattern params). The warning names the controller, method, route, and schema identifier, and suggests exporting the schema with a static import specifier. No warning is emitted when no schema is wired or when `typegen.schemaValidator` is `false`.

- [#358](https://github.com/forinda/kick-js/pull/358) [`00d6859`](https://github.com/forinda/kick-js/commit/00d6859279877b5f5cfe8445f64f3d91ceb5e7cc) Thanks [@forinda](https://github.com/forinda)! - Two dev-loop fixes:

  **Typegen-on-save for bare `vite` boots.** The vite plugin array now includes `kickjs:typegen`, which wires the same debounced typegen watcher `kick dev` uses — so projects (or tools) that boot Vite directly no longer run with silently frozen `.kickjs/types`. The engine is the CLI's new exported `createTypegenDevWatcher()`; the plugin resolves `@forinda/kickjs-cli` from the project root at runtime (optional peer — manifest-walk resolution, since the ESM-only exports map defeats `require.resolve`) and quietly stands down when the CLI is absent or when `kick dev` has claimed ownership via `TYPEGEN_OWNER_KEY` (no double-running). A startup catch-up pass covers edits made while no dev server was running.

  **Errors now surface on save, not on the next request.** The app module was re-evaluated lazily after HMR/module-discovery invalidation, so a broken save (syntax error, failed import, bootstrap throw) stayed silent until an HTTP request arrived. Both invalidation paths now eagerly re-warm `virtual:kickjs/app` and log the failure (with fixed stacktraces) the moment the save lands — matching the eager startup behavior.

### Patch Changes

- [#348](https://github.com/forinda/kick-js/pull/348) [`6597fcb`](https://github.com/forinda/kick-js/commit/6597fcb9cfc5336303944213d49e9e1b71d24252) Thanks [@forinda](https://github.com/forinda)! - `kick dev` no longer silently swallows typegen failures in watch mode. A failed scan or plugin pass now prints a deduplicated console warning ("types in .kickjs/types may be stale") and broadcasts a `kickjs:typegen-error` custom HMR event for DevTools/overlays. Repeated identical failures stay quiet until the error changes or a pass succeeds again.

- [#348](https://github.com/forinda/kick-js/pull/348) [`78fc8b3`](https://github.com/forinda/kick-js/commit/78fc8b357e838c84630ed27a56fe82674389567e) Thanks [@forinda](https://github.com/forinda)! - `kick info` now reports real data instead of a hardcoded three-package "workspace" list: the CLI's own version, plus every `@forinda/kickjs*` dependency the project declares with the version actually installed in `node_modules` (falling back to the declared range when not installed) and a `[DEPRECATED]` flag for packages the `kick add` catalog marks as deprecated. `kick -v` now works as an alias for `-V` / `--version`.

- [#357](https://github.com/forinda/kick-js/pull/357) [`781db49`](https://github.com/forinda/kick-js/commit/781db49cf1c3e2baced838aa7c07deeb359efa81) Thanks [@forinda](https://github.com/forinda)! - Scaffolded projects now get `"dev": "kick dev"` instead of bare `"dev": "vite"`. The typegen-on-save watcher (and the opt-in `--typecheck` worker) live only in `kick dev` — the bare `vite` script gave working HMR with silently frozen `.kickjs/types`, so adding a route or controller required a manual `kick typegen` to refresh its typing. Existing projects: change the `dev` script in package.json to `kick dev`.

- Updated dependencies [[`bdd9757`](https://github.com/forinda/kick-js/commit/bdd975792ace8fb4e53f542802db7f7610119fcc), [`889fce7`](https://github.com/forinda/kick-js/commit/889fce7f2f02229d8af6bca062fb5642172add8d), [`92c8ce5`](https://github.com/forinda/kick-js/commit/92c8ce5c28384c5e12cad34f1f4c41307b47b966), [`57001c3`](https://github.com/forinda/kick-js/commit/57001c376090cf838db4c9b2dac672a317c21e33), [`e8133d2`](https://github.com/forinda/kick-js/commit/e8133d2c0df13dd59db98637f4ec1a13181ff884)]:
  - @forinda/kickjs-db@6.2.0

## 6.0.1

### Patch Changes

- Updated dependencies [[`fe409a2`](https://github.com/forinda/kick-js/commit/fe409a2ef6c16384271e6536a93c89129bf2bccd)]:
  - @forinda/kickjs-cli-kit@0.1.1
  - @forinda/kickjs-db@6.1.1

## 6.0.0

### Major Changes

- [#329](https://github.com/forinda/kick-js/pull/329) [`e63875d`](https://github.com/forinda/kick-js/commit/e63875ddd772c0981eca086cf9669380d231bd6c) Thanks [@forinda](https://github.com/forinda)! - Lean generators: REST + minimal only, name-based repositories, flat scaffold.

  **Breaking — project templates.** The `ddd` and `cqrs` generator patterns are removed. `kick new` / `kick g module` now offer only `rest` (the new default) and `minimal`. Projects that passed `--template ddd|cqrs` (or set `pattern: 'ddd'|'cqrs'` in `kick.config.ts`) now generate the flat REST layout. Existing hand-written DDD/CQRS code is untouched — only the generators changed.

  **Deprecated — ORM repository presets.** The dedicated `prisma` and `drizzle` repository generators are gone. The repo prompt is now a free-text name: `inmemory` (the zero-dep default, unchanged) or any DB name (e.g. `postgres`, `mongo`) which scaffolds a generic custom-repository stub you wire to your own client. Passing `--repo prisma|drizzle` still works — it just emits the generic stub and prints a deprecation note. Pass a name via `--repo <name>` or `modules.repo: { name: '<name>' }`.

  **`kick g scaffold` now emits the flat REST layout** (controller + service + field-aware DTOs + repository) instead of the removed DDD layout. The `--fields name:type` feature is unchanged; the generated in-memory/custom repository now builds entities by spreading the create DTO, so it works for any field set.

  To keep DDD/CQRS scaffolding, pin to the previous CLI major.

### Minor Changes

- [#334](https://github.com/forinda/kick-js/pull/334) [`f050f6b`](https://github.com/forinda/kick-js/commit/f050f6b235d1fc54f7adc790cd2b5c999411c5c6) Thanks [@forinda](https://github.com/forinda)! - Ship the database CLI from `@forinda/kickjs-db/cli` — a mountable plugin **and** a standalone `kickjs-db` bin — so you can use the db tooling without (or alongside) `@forinda/kickjs-cli`.

  **New: `@forinda/kickjs-db/cli`**

  - `dbCliPlugin` — a CLI plugin (`@forinda/kickjs-cli-kit` contract). Mount it in `kick.config.ts` to get `kick db generate | migrate latest|up|down|rollback|status|review | introspect`. It reads config from the same `kick.config.ts` `db` block (via `ctx.config`, no re-parse).
  - `defineKickDbConfig` / `mergeKickDbConfig` / `resolveKickDbConfig` — vite-style config helpers. Author a standalone `kickjs-db.config.ts` (`export default defineKickDbConfig({ ... })`) or reuse the `kick.config.ts` `db` block; the two merge (later wins).
  - Standalone **`kickjs-db` bin** — `npx kickjs-db migrate latest` runs the whole command tree without kickjs-cli, loading `kickjs-db.config.ts` (or a `kick.config.ts` `db` block) through jiti.

  **Breaking (`@forinda/kickjs-cli`): `kick db` is now opt-in.**
  The `kick db` commands are no longer built into kickjs-cli. Add the plugin to your config:

  ```ts
  import { defineConfig } from "@forinda/kickjs-cli";
  import { dbCliPlugin } from "@forinda/kickjs-db/cli";

  export default defineConfig({ plugins: [dbCliPlugin] });
  ```

  Zero-config **db type generation is unchanged** — it stays a built-in typegen (`kick typegen` still emits `.kickjs/types` for your schema). Only the `kick db` _commands_ moved.

- [#332](https://github.com/forinda/kick-js/pull/332) [`456e280`](https://github.com/forinda/kick-js/commit/456e280eaef89b0d0c357a06edbde6f8e7c2c789) Thanks [@forinda](https://github.com/forinda)! - SQLite migration generation, a `migrate review` command, and drift handling for non-Postgres dialects.

  - **`kick db generate` now emits SQLite DDL** when `db.dialect: 'sqlite'`. Previously the migration emitter was Postgres-only, so SQLite projects couldn't generate migrations from their schema (only the runner worked). The new `emitSqlite` maps PG types to SQLite affinities, normalises defaults (`gen_random_uuid()` → `(lower(hex(randomblob(16))))`, `false` → `0`, `now()` → `CURRENT_TIMESTAMP`), inlines a single integer PK as `INTEGER PRIMARY KEY` (rowid), and folds foreign keys into `CREATE TABLE` (SQLite has no `ALTER ... ADD CONSTRAINT`). Operations SQLite can't express via `ALTER TABLE` (column type/null/default changes, FK changes on an existing table) throw a clear `SqliteRebuildRequiredError` pointing at `kick db generate --empty` instead of emitting wrong SQL. `generate` now dispatches the emitter by dialect.

  - **`kick db migrate review <id>`** marks a migration reviewed: it flips `meta.json.reviewed`, swaps the `-- REVIEWED: false` markers in `up.sql`/`down.sql`, and recomputes the journal hash so all three stay in sync. Previously the only way to review was hand-editing `meta.json`, which left the SQL markers and the hash out of sync (the runner gates on `meta.json.reviewed`, not the comment).

  - **Drift detection is skipped for SQLite/MySQL** — only the Postgres adapter implements `introspect()`, so `kick db migrate` no longer fails with "introspection not supported" on those dialects (PostgreSQL keeps the default `error` behaviour).

- [#327](https://github.com/forinda/kick-js/pull/327) [`bebd92d`](https://github.com/forinda/kick-js/commit/bebd92df749ef4d9de283df066e8074594e338c9) Thanks [@forinda](https://github.com/forinda)! - Incremental asset builds — `buildAssets` no longer re-copies every file on each run.

  `kick build` / `kick build:assets` now skip copying any asset whose destination is already up to date (exists, same byte size, mtime ≥ source), turning a no-change rebuild into a cheap stat sweep instead of a full re-copy. The `.kickjs-assets.json` manifest is still written with every matched file, so output is identical — only redundant copies are elided. `BuildAssetsEntryResult.filesCopied` now reports the number of files actually written (0 when nothing changed).

  `kick dev` wires this into the watcher: when an `assetMap.<ns>.src` directory changes, it runs the incremental asset build (debounced, alongside typegen) so the dist copies + manifest stay fresh without rebuilding everything on every save.

- [#327](https://github.com/forinda/kick-js/pull/327) [`3162704`](https://github.com/forinda/kick-js/commit/316270487b6e3ae4bb1ebc48b59646bd8b29c8e8) Thanks [@forinda](https://github.com/forinda)! - Detect `defineModule()` factory modules in typegen, and quiet per-plugin logs by default.

  - **`ModuleToken` now includes v4 `defineModule()` modules.** The scanner previously only recognised the deprecated `class X implements AppModule` form, so a project using the v4 `export const XModule = defineModule({ ... })` idiom emitted `export type ModuleToken = never`. The scanner now also picks up `defineModule()` consts (per-file, so it's cache/incremental-safe), populating `ModuleToken` with each module name.
  - **Per-plugin typegen status lines are now debug-only.** `kick typegen` printed a `kick/<id>: <status>` line for every plugin on each run. That list is now gated behind `LOG_LEVEL=debug` (or `trace`); a normal run prints just the one-line `kick typegen → …` summary. Set `LOG_LEVEL=debug` to see the full per-plugin breakdown.

- [#327](https://github.com/forinda/kick-js/pull/327) [`db526e9`](https://github.com/forinda/kick-js/commit/db526e958b4237cba62fcaf1f23b22a223a1db0c) Thanks [@forinda](https://github.com/forinda)! - Speed up `kick typegen` / `kick dev` / `kick build` on large projects with a persistent, incremental scanner.

  The typegen scanner used to re-read and re-regex every `src/**/*.ts` file on every run, serially. Two changes cut that cost:

  - **Persistent per-file cache** (`.kickjs/cache/scan.json`, already gitignored): each file's extraction is cached keyed by a cheap `mtimeMs:size` signature, so a watch/rebuild only re-reads genuinely-changed files. Reads + extraction now also run concurrently. Warm scans are ~3× faster than a cold scan.
  - **Walk-free incremental scan in `kick dev`**: the dev server feeds Vite's exact chokidar delta to the scanner, which re-extracts only the changed files and skips the directory walk entirely — ~2.8× faster again than a warm full scan (≈8.5× over the original cold scan on a 1,500-module project).

  Correctness is preserved: the cross-file join (mount-prefix route params, glob-orphan detection) always re-runs over the full cached + fresh extract set, so cached entries can never desync output. File deletions are handled — single-file `unlink` events drop the file from the scan and prune the cache; a directory `unlinkDir` (which carries no precise per-file delta) falls back to a full re-scan. No public API or config changes; the cache is transparent and self-healing (a missing or version-mismatched cache simply behaves like a cold first run).

### Patch Changes

- [#333](https://github.com/forinda/kick-js/pull/333) [`b6b6832`](https://github.com/forinda/kick-js/commit/b6b683292596bec023104a7fc2b3d8e5a958f36a) Thanks [@forinda](https://github.com/forinda)! - Extract the CLI-plugin contract into a new dependency-free package, `@forinda/kickjs-cli-kit`.

  `defineCliPlugin`, `defineGenerator`, `KickCliPlugin`, `KickCliPluginContext`, `GeneratorSpec` (+ friends), `KickCommandDefinition`, and `KickPluginConflictError` now live in `@forinda/kickjs-cli-kit`. This lets packages ship `kick`-compatible commands and generators **without** depending on `@forinda/kickjs-cli` — which previously caused a dependency cycle for first-party packages the CLI itself mounts (e.g. the database tooling).

  `@forinda/kickjs-cli` re-exports the whole contract, so existing imports (`import { defineCliPlugin } from '@forinda/kickjs-cli'`) keep working unchanged. The plugin context's config is generic (`KickCliPluginContext<TConfig>`); the CLI narrows it to its `KickConfig`.

  No behaviour change — pure contract extraction.

- [#330](https://github.com/forinda/kick-js/pull/330) [`91cf40f`](https://github.com/forinda/kick-js/commit/91cf40f2925b733dd39d46f3faf8ce29120c84f1) Thanks [@forinda](https://github.com/forinda)! - Fix `kick db` with plugin-importing configs, and non-string column defaults.

  - **`kick db` commands now load `kick.config.ts` through the CLI's jiti loader** (`loadKickConfig`) instead of `@forinda/kickjs-db`'s native `import()`. Native ESM can't resolve the extensionless, relative TypeScript imports a config commonly uses — e.g. `import { toolsPlugin } from './tools/cli-plugin'` to mount a CLI plugin — so every `kick db ...` command failed with `Cannot find module` whenever the config imported local TS. It now resolves exactly like the rest of the CLI.

  - **Column `.default()` accepts `string | number | boolean`** and normalises non-strings to their SQL-literal text. `boolean().default(false)` / `integer().default(0)` previously stored a raw boolean/number in the snapshot, which crashed migration emit with `value.replace is not a function`. The Postgres emitter (`formatDefault`) is also hardened to coerce booleans/numbers defensively, so a pre-existing snapshot with a non-string default emits a bare SQL literal (`false`, `0`) instead of throwing.

- [#331](https://github.com/forinda/kick-js/pull/331) [`4ba020e`](https://github.com/forinda/kick-js/commit/4ba020ed043dc0ee8f696661035891824a3e83f8) Thanks [@forinda](https://github.com/forinda)! - Consolidate the SQL dialect adapters into `@forinda/kickjs-db` subpaths.

  The PostgreSQL / SQLite / MySQL adapters + dialects now ship from **subpaths of `@forinda/kickjs-db`** instead of separate packages — mirroring how `@forinda/kickjs-schema` exposes `./zod` / `./valibot` / `./yup`. Install one package plus the single driver you use:

  ```bash
  # before
  pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg
  # after
  pnpm add @forinda/kickjs-db pg
  ```

  ```ts
  // before
  import { pgAdapter, pgDialect } from "@forinda/kickjs-db-pg";
  // after
  import { pgAdapter, pgDialect } from "@forinda/kickjs-db/pg";
  ```

  - New subpaths: `@forinda/kickjs-db/pg` (now also carries `pgAdapter` + `pgDialect` alongside the PG column types), `@forinda/kickjs-db/sqlite`, `@forinda/kickjs-db/mysql`.
  - `pg`, `better-sqlite3`, `mysql2` are **optional peer deps** of `@forinda/kickjs-db` — the relevant subpath imports its driver lazily, so the core install never pulls all three.
  - `@forinda/kickjs-db-pg` / `-sqlite` / `-mysql` remain as **deprecated re-export shims** (`export * from '@forinda/kickjs-db/<dialect>'`) so existing installs keep working; they'll be removed in a future major.
  - CLI: `kick db` resolves the pg adapter from `@forinda/kickjs-db/pg`; `kick add pg|sqlite|mysql` installs `@forinda/kickjs-db` plus the matching driver.

- [#335](https://github.com/forinda/kick-js/pull/335) [`cda92e7`](https://github.com/forinda/kick-js/commit/cda92e79e0bdc7a6a46c4f428dc10da4ad115a8f) Thanks [@forinda](https://github.com/forinda)! - The `kick/db` type generation now ships on `dbCliPlugin` (exported as `kickDbTypegen` from `@forinda/kickjs-db/cli`), so mounting the plugin brings **both** the `kick db` commands and `.kickjs/types/kick__db.d.ts` generation from one opt-in.

  Previously the db typegen was a kickjs-cli built-in while the commands lived in the plugin — split across two packages. Now `@forinda/kickjs-db/cli` owns the full db CLI surface. kickjs-cli's `kickDbTypegen` export stays as a re-export shim for back-compat, but it is no longer auto-registered — add `dbCliPlugin` to `kick.config.ts` `plugins: []` to get db types (the same mount that enables the commands).

- [#324](https://github.com/forinda/kick-js/pull/324) [`ee9bcff`](https://github.com/forinda/kick-js/commit/ee9bcffe7c9a28617dfd62b1516defd51fc9ea70) Thanks [@forinda](https://github.com/forinda)! - `kick g <generator> <name>` no longer silently scaffolds modules when the generator name fails to route. The bare `kick g <names...>` form is module shorthand and previously sent ANY unmatched first token straight to module generation — so on a CLI older than a given generator (e.g. `contributor`), `kick g contributor tenant` quietly created modules named `contributor` and `tenant` instead of erroring. The fallback now refuses a reserved generator name with a clear message (and an "upgrade your CLI" hint) instead of scaffolding modules. Plain module shorthand (`kick g user task`) is unaffected.

- [#323](https://github.com/forinda/kick-js/pull/323) [`6396452`](https://github.com/forinda/kick-js/commit/639645286383510d662e90008d0dd51b9d8d1875) Thanks [@forinda](https://github.com/forinda)! - `kick add zod | valibot | yup` now installs the schema validator.

  The validator is an optional peer of `@forinda/kickjs` (the framework
  lazy-loads it), so a project that installs one in any other way hits
  `Cannot find module 'zod'` at startup. They weren't in the `kick add`
  registry before (`kick add zod` → "Unknown packages: zod"); now they're
  first-class entries, so existing projects can add or switch schema libs
  in one step. `kick new` already installs the chosen one.

- Updated dependencies [[`b6b6832`](https://github.com/forinda/kick-js/commit/b6b683292596bec023104a7fc2b3d8e5a958f36a), [`f050f6b`](https://github.com/forinda/kick-js/commit/f050f6b235d1fc54f7adc790cd2b5c999411c5c6), [`91cf40f`](https://github.com/forinda/kick-js/commit/91cf40f2925b733dd39d46f3faf8ce29120c84f1), [`4ba020e`](https://github.com/forinda/kick-js/commit/4ba020ed043dc0ee8f696661035891824a3e83f8), [`cf3ba8c`](https://github.com/forinda/kick-js/commit/cf3ba8cb56e70385cc6906371d2f8cb3846a2093), [`3b00de4`](https://github.com/forinda/kick-js/commit/3b00de462ebe6f1772cfe0e44c1c04d3a45a4ddf), [`66aae3c`](https://github.com/forinda/kick-js/commit/66aae3cf8c3bd87d14eaa0085d9ca15181fa97fe), [`456e280`](https://github.com/forinda/kick-js/commit/456e280eaef89b0d0c357a06edbde6f8e7c2c789), [`e0e7c34`](https://github.com/forinda/kick-js/commit/e0e7c34ed46b70e1dcfecdf178a7d6f7e774beb9), [`cda92e7`](https://github.com/forinda/kick-js/commit/cda92e79e0bdc7a6a46c4f428dc10da4ad115a8f), [`bcada77`](https://github.com/forinda/kick-js/commit/bcada7784a2e866a512c25856ff1c94ca44ed92b)]:
  - @forinda/kickjs-cli-kit@0.1.0
  - @forinda/kickjs-db@6.1.0
  - @forinda/kickjs@5.16.0

## 5.11.1

### Patch Changes

- [#321](https://github.com/forinda/kick-js/pull/321) [`5dc5a99`](https://github.com/forinda/kick-js/commit/5dc5a991df7c92dd7c369f6f87a3b005ba3dea13) Thanks [@forinda](https://github.com/forinda)! - Fix two `kick dev` (Vite) lifecycle gaps — neither was Windows-specific, though Windows made the shutdown one worse.

  - **App now bootstraps at startup, not on first request.** The dev-server plugin evaluated the app lazily via `ssrLoadModule` inside the request middleware, so `bootstrap()`, adapter `afterStart`, and your startup logs didn't run until the first HTTP request hit. The plugin now warms the module once the HTTP server is listening, so `kick dev` behaves like `node`/`tsx` — logs + adapters + the server come up immediately.
  - **Graceful shutdown now runs on Ctrl+C in dev.** The app deliberately suppresses its own SIGINT/SIGTERM handlers in dev (Vite owns the lifecycle), and the CLI dev server only closed Vite — so `adapter.shutdown()`, request draining, and shutdown logs never ran. `Application.start()` now exposes its `shutdown()` on `globalThis` in dev, and `kick dev` awaits it before tearing down Vite. Also wires `SIGBREAK` (Windows Ctrl+Break) since Windows never raises `SIGTERM`.

- Updated dependencies [[`5dc5a99`](https://github.com/forinda/kick-js/commit/5dc5a991df7c92dd7c369f6f87a3b005ba3dea13)]:
  - @forinda/kickjs@5.15.1
  - @forinda/kickjs-db@6.0.0

## 5.11.0

### Minor Changes

- [#315](https://github.com/forinda/kick-js/pull/315) [`55b7c96`](https://github.com/forinda/kick-js/commit/55b7c9688fcdaa490beca9da41b18dd9e03c70db) Thanks [@forinda](https://github.com/forinda)! - Add the `kick/context` typegen plugin — auto-populate `ContextKeys` from context-decorator key literals.

  `kick typegen` now scans every `defineContextDecorator({ key })` / `defineHttpContextDecorator({ key })` call (including the curried `.withParams<T>()({ key })` form) and emits `.kickjs/types/kick__context.d.ts` augmenting the `ContextKeys` registry. This makes a Context Contributor's `dependsOn` typo-checked automatically — no hand-maintained registry, and no need to give a key a value type in `ContextMeta` just to depend on it.

  Pairs with the `ContextKeys` registry: `dependsOn` narrows to `keyof ContextMeta | keyof ContextKeys`, so the generated augmentation feeds typo-checking while `ContextMeta` keeps driving `ctx.get(key)` value types. The plugin skips emission when no context decorators are found. Scanner gains `extractContextKeysFromSource` + `ScanResult.contextKeys`.

- [#313](https://github.com/forinda/kick-js/pull/313) [`1190b56`](https://github.com/forinda/kick-js/commit/1190b565c8769402c01ae77df6c81dc328aaf79b) Thanks [@forinda](https://github.com/forinda)! - Add `kick g contributor <name>` to scaffold a Context Contributor.

  - `--type http` (default) → `defineHttpContextDecorator`, resolver typed against `RequestContext`.
  - `--type bare` → `defineContextDecorator`, resolver typed against the transport-agnostic `ExecutionContext`.
  - `--params "source:string,region:number"` → emits the curried `.withParams<T>()` form with a generated params `type` alias and `paramDefaults` stub (mirrors how `kick g scaffold` takes field definitions).
  - `--key <key>` overrides the context key (defaults to camelCase of the name); `-m <module>` scopes the file into a module folder.

  The scaffold also drops a `ContextMeta` augmentation stub so `ctx.get('<key>')` is typed and `dependsOn: ['<key>']` is checked.

### Patch Changes

- [#314](https://github.com/forinda/kick-js/pull/314) [`07995b9`](https://github.com/forinda/kick-js/commit/07995b9576e04298d52e0a45b9906360a4da55ac) Thanks [@forinda](https://github.com/forinda)! - Fix two issues in the plugin-only typegen pipeline (follow-up to the generator.ts retirement):

  - **Polling watch never regenerated types.** `kick typegen --watch` / `kick dev` on the polling paths (forced via `KICKJS_WATCH_POLLING`, or the `fs.watch` fallback used on Docker bind mounts / WSL / NFS) ran only the scan + collision gate, not the plugin pass — so no `.kickjs/types/kick__*` file refreshed on change. Both polling paths now drive the full `runLegacy().then(runPlugins)` chain, matching the event-based watcher.
  - **`kick dev` startup could abort on a typegen error.** The startup plugin pass + artifact write were unguarded, so a scanner/fs error would exit the dev server with code 1. Now wrapped in try/catch + warn, consistent with the scan/gate pass and the debounced refresh.

- [#310](https://github.com/forinda/kick-js/pull/310) [`285262f`](https://github.com/forinda/kick-js/commit/285262f1243d6a6623b6c54669ec04fe409ab7d5) Thanks [@forinda](https://github.com/forinda)! - Make `kick typegen` fully plugin-based and retire the legacy monolithic generator.

  The `KickJsRegistry`, `ServiceToken`/`ModuleToken` unions, `KickJsPluginRegistry`, and the `defineAugmentation` catalogue are now each emitted by their own typegen plugin (`kick/registry`, `kick/services`, `kick/modules`, `kick/plugins`, `kick/augmentations`) — joining the already-carved `kick/routes`, `kick/env`, `kick/assets`, `kick/db`. `typegen/generator.ts` is removed; `runTypegen` now just scans, gates collisions, runs the plugin pipeline, and finalises.

  Effects:

  - Output files are renamed to the uniform `kick__*` scheme (`kick__registry.d.ts`, `kick__services.d.ts`, …). The barrel `index.d.ts` is dropped — the scaffolded tsconfig pulls `.kickjs/types/**` in via `include`, so augmentations apply by inclusion and the barrel's re-exports were redundant.
  - The whole pipeline is now uniformly per-plugin-isolated (a throw in one plugin can't block the others).
  - Upgrading is automatic: the first run sweeps the old `index.d.ts` / `registry.d.ts` / `services.d.ts` / `modules.d.ts` / `plugins.d.ts` / `augmentations.d.ts` files.

  Tracking issue [#309](https://github.com/forinda/kick-js/issues/309).

- [#307](https://github.com/forinda/kick-js/pull/307) [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504) Thanks [@forinda](https://github.com/forinda)! - Fix asset manager interfering with controller typegen, and make `assets.x.y()` resolve in dev for `kick.config.ts` projects.

  - **Typegen runner is now per-plugin isolated.** A throw in one typegen plugin (e.g. `kick/assets`) no longer aborts the whole pass — it's reported as an `error` and the remaining plugins (e.g. `kick/routes`) still run. Previously one failing plugin left the controller route types ungenerated.
  - **The stale-file sweep is now an allowlist, not a denylist.** It only removes the known pre-carve legacy filenames (`assets.d.ts`, `env.ts`, `routes.ts`) and never touches unknown/custom files. Previously, when the plugin pass returned nothing (e.g. it aborted), the sweep deleted live `kick__routes.ts` / `kick__assets.d.ts` — wiping controller types project-wide.
  - **Dev-mode asset resolution now works with `kick.config.ts`.** The runtime resolver reads config synchronously and can't transpile TS, so a `.ts`-config project had no manifest to resolve from until the first production build (`assets.x.y()` threw `UnknownAssetError`). The CLI now mirrors the JSON-serialisable `assetMap` + `build.outDir` into `.kickjs/kick.config.json` whenever it loads the config, and the runtime resolver reads that snapshot as a fallback.

- Updated dependencies [[`90299cf`](https://github.com/forinda/kick-js/commit/90299cf76e6aa81776ed109db93ec5dcefea68c7), [`80e0fdf`](https://github.com/forinda/kick-js/commit/80e0fdf30d3d1b7e5d749cb015f77891847eefa6), [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504), [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504)]:
  - @forinda/kickjs@5.15.0
  - @forinda/kickjs-db@6.0.0

## 5.10.2

### Patch Changes

- Updated dependencies []:
  - @forinda/kickjs@5.14.2
  - @forinda/kickjs-db@6.0.0

## 5.10.1

### Patch Changes

- Updated dependencies []:
  - @forinda/kickjs@5.14.1
  - @forinda/kickjs-db@6.0.0

## 5.10.0

### Minor Changes

- [#297](https://github.com/forinda/kick-js/pull/297) [`5615305`](https://github.com/forinda/kick-js/commit/5615305d4bdc7e8db929028a37f8fcbaa07ca82c) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds projects on top of `@forinda/kickjs-schema` instead of the legacy `defineEnv` + raw Zod setup.

  **New `--schema` flag.** Pick the env / DTO validation library at scaffold time:

  ```sh
  kick new my-api --schema zod     # default
  kick new my-api --schema valibot
  kick new my-api --schema yup
  ```

  `--yes` defaults to `zod`. Interactive mode adds a "Schema library" prompt between repo selection and optional packages.

  **Generated env file** now uses `loadEnvFromSchema(fromX(...))` so the same `KickSchema` flows through the env loader, the validate middleware, and the swagger spec generator. The default export is the wrapped schema — `kick typegen` reads it via `InferSchemaOutput<typeof _envSchema>` to populate `KickEnv`. The legacy `defineEnv(...)` + `loadEnv(...)` scaffold path is removed.

  **Generated `kick.config.ts`** sets `typegen.schemaValidator: 'kickjs-schema'` so typegen routes through `InferSchemaOutput` for any wrapped schema — Zod, Valibot, or Yup all work without changing the typegen config.

  **Generated `package.json`** now always installs `@forinda/kickjs-schema` and only the chosen schema lib (`zod` / `valibot` / `yup`), not all three.

  **Swagger** adds adapter-integration tests (`packages/swagger/__tests__/schema-detection.test.ts`) covering real Zod / Valibot / Yup schemas through the `@Post('/', { body: ... })` pipeline + OpenAPI spec generation.

- [#291](https://github.com/forinda/kick-js/pull/291) [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50) Thanks [@forinda](https://github.com/forinda)! - Schema-agnostic validation abstraction

  **New package: `@forinda/kickjs-schema`**

  - `KickSchema` interface — unified `safeParse()`, `toJsonSchema()`, `_raw`
  - `SchemaIssue` — normalized error format (path, message, code, expected, received)
  - `detectSchema()` — auto-detects KickSchema, Zod, Valibot, Yup, Standard Schema v1, functions, and duck-typed schemas
  - `registerAdapter()` — plug in custom schema libraries at runtime
  - `InferSchemaOutput<T>` — type-level inference for Zod, Valibot, Standard Schema, and KickSchema

  **Adapters (tree-shakable sub-exports):**

  - `@forinda/kickjs-schema/zod` — `fromZod()` with full issue normalization and JSON Schema via `.toJSONSchema()`
  - `@forinda/kickjs-schema/valibot` — `fromValibot()` with issue mapping and JSON Schema via `@valibot/to-json-schema`
  - `@forinda/kickjs-schema/yup` — `fromYup()` with `validateSync` error mapping and JSON Schema from `describe()` metadata

  **Framework integration:**

  - `validate()` middleware uses `detectSchema()` — accepts any supported schema library
  - Swagger `SchemaParser` uses `detectSchema().toJsonSchema()` instead of Zod-specific conversion
  - MCP adapter uses `detectSchema()` for tool input/output schema conversion
  - `loadEnvFromSchema()` — schema-agnostic env loader alongside existing Zod-only `loadEnv()`

  **Typegen:**

  - New `schemaValidator: 'kickjs-schema'` option emits `InferSchemaOutput<>` for route body/query/params and env types
  - Default `'zod'` unchanged — fully backward compatible
  - CLI: `kick typegen --schema-validator kickjs-schema`

- [#297](https://github.com/forinda/kick-js/pull/297) [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb) Thanks [@forinda](https://github.com/forinda)! - Fix schema-driven env typing end-to-end across `@forinda/kickjs-schema`, `loadEnvFromSchema`, and `kick typegen`.

  **`@forinda/kickjs-schema`**

  - `fromZod` / `fromValibot` / `fromYup` now infer their output type from the wrapped schema via `InferSchemaOutput<TSchema>`. Previously the `<TOutput = unknown>` generic defaulted to `unknown` whenever the caller didn't spell the output type explicitly — every wrapped schema landed at `KickSchema<unknown>` and propagated `unknown` into `KickEnv`. The explicit `<TOutput>` overload was dropped because TypeScript overload resolution always picked it with `TOutput = unknown` before reaching the inferring overload; adopters who want to spell the output type explicitly can cast (`fromZod(s) as KickSchema<MyShape>`) instead.
  - `InferSchemaOutput<T>` now resolves the Standard Schema brand (`~standard.types.output`) before Zod's `_output` (Zod v4 sometimes types `_output` as `never` on object schemas, which would mask the real shape), and adds a final branch for Yup's `__outputType`.

  **`@forinda/kickjs`**

  - `loadEnvFromSchema` now takes `<TSchema>(schema: TSchema): InferSchemaOutput<TSchema>` so the call site lands at the real env shape instead of `Record<string, unknown>`. A second overload preserves the `Record<string, unknown>` fallback for adopters who pass a runtime-only validator with no static brand.

  **`@forinda/kickjs-cli`**

  - `kick typegen` env-file detection regex broadened to match `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` / `loadEnvFromSchema(...)` in addition to the legacy `defineEnv(...)`. Projects migrating off `defineEnv` to the schema-agnostic loader no longer get a silent `kick/env: skipped`.
  - Env renderer flattens the kickjs-schema inference via a mapped-type identity (`type _Resolved = { [K in keyof _Raw]: _Raw[K] }`) so `interface KickEnv extends _Resolved {}` lands at an object type TS accepts. Without it, `InferSchemaOutput<typeof envSchema>` stays as a conditional type and the interface extension errors with TS2312 ("interface can only extend an object type with statically known members") even when the conditional resolves to a plain object.

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0
  - @forinda/kickjs-db@6.0.0

## 5.10.0-alpha.0

### Minor Changes

- [#297](https://github.com/forinda/kick-js/pull/297) [`5615305`](https://github.com/forinda/kick-js/commit/5615305d4bdc7e8db929028a37f8fcbaa07ca82c) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds projects on top of `@forinda/kickjs-schema` instead of the legacy `defineEnv` + raw Zod setup.

  **New `--schema` flag.** Pick the env / DTO validation library at scaffold time:

  ```sh
  kick new my-api --schema zod     # default
  kick new my-api --schema valibot
  kick new my-api --schema yup
  ```

  `--yes` defaults to `zod`. Interactive mode adds a "Schema library" prompt between repo selection and optional packages.

  **Generated env file** now uses `loadEnvFromSchema(fromX(...))` so the same `KickSchema` flows through the env loader, the validate middleware, and the swagger spec generator. The default export is the wrapped schema — `kick typegen` reads it via `InferSchemaOutput<typeof _envSchema>` to populate `KickEnv`. The legacy `defineEnv(...)` + `loadEnv(...)` scaffold path is removed.

  **Generated `kick.config.ts`** sets `typegen.schemaValidator: 'kickjs-schema'` so typegen routes through `InferSchemaOutput` for any wrapped schema — Zod, Valibot, or Yup all work without changing the typegen config.

  **Generated `package.json`** now always installs `@forinda/kickjs-schema` and only the chosen schema lib (`zod` / `valibot` / `yup`), not all three.

  **Swagger** adds adapter-integration tests (`packages/swagger/__tests__/schema-detection.test.ts`) covering real Zod / Valibot / Yup schemas through the `@Post('/', { body: ... })` pipeline + OpenAPI spec generation.

- [#291](https://github.com/forinda/kick-js/pull/291) [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50) Thanks [@forinda](https://github.com/forinda)! - Schema-agnostic validation abstraction

  **New package: `@forinda/kickjs-schema`**

  - `KickSchema` interface — unified `safeParse()`, `toJsonSchema()`, `_raw`
  - `SchemaIssue` — normalized error format (path, message, code, expected, received)
  - `detectSchema()` — auto-detects KickSchema, Zod, Valibot, Yup, Standard Schema v1, functions, and duck-typed schemas
  - `registerAdapter()` — plug in custom schema libraries at runtime
  - `InferSchemaOutput<T>` — type-level inference for Zod, Valibot, Standard Schema, and KickSchema

  **Adapters (tree-shakable sub-exports):**

  - `@forinda/kickjs-schema/zod` — `fromZod()` with full issue normalization and JSON Schema via `.toJSONSchema()`
  - `@forinda/kickjs-schema/valibot` — `fromValibot()` with issue mapping and JSON Schema via `@valibot/to-json-schema`
  - `@forinda/kickjs-schema/yup` — `fromYup()` with `validateSync` error mapping and JSON Schema from `describe()` metadata

  **Framework integration:**

  - `validate()` middleware uses `detectSchema()` — accepts any supported schema library
  - Swagger `SchemaParser` uses `detectSchema().toJsonSchema()` instead of Zod-specific conversion
  - MCP adapter uses `detectSchema()` for tool input/output schema conversion
  - `loadEnvFromSchema()` — schema-agnostic env loader alongside existing Zod-only `loadEnv()`

  **Typegen:**

  - New `schemaValidator: 'kickjs-schema'` option emits `InferSchemaOutput<>` for route body/query/params and env types
  - Default `'zod'` unchanged — fully backward compatible
  - CLI: `kick typegen --schema-validator kickjs-schema`

- [#297](https://github.com/forinda/kick-js/pull/297) [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb) Thanks [@forinda](https://github.com/forinda)! - Fix schema-driven env typing end-to-end across `@forinda/kickjs-schema`, `loadEnvFromSchema`, and `kick typegen`.

  **`@forinda/kickjs-schema`**

  - `fromZod` / `fromValibot` / `fromYup` now infer their output type from the wrapped schema via `InferSchemaOutput<TSchema>`. Previously the `<TOutput = unknown>` generic defaulted to `unknown` whenever the caller didn't spell the output type explicitly — every wrapped schema landed at `KickSchema<unknown>` and propagated `unknown` into `KickEnv`. The explicit `<TOutput>` overload was dropped because TypeScript overload resolution always picked it with `TOutput = unknown` before reaching the inferring overload; adopters who want to spell the output type explicitly can cast (`fromZod(s) as KickSchema<MyShape>`) instead.
  - `InferSchemaOutput<T>` now resolves the Standard Schema brand (`~standard.types.output`) before Zod's `_output` (Zod v4 sometimes types `_output` as `never` on object schemas, which would mask the real shape), and adds a final branch for Yup's `__outputType`.

  **`@forinda/kickjs`**

  - `loadEnvFromSchema` now takes `<TSchema>(schema: TSchema): InferSchemaOutput<TSchema>` so the call site lands at the real env shape instead of `Record<string, unknown>`. A second overload preserves the `Record<string, unknown>` fallback for adopters who pass a runtime-only validator with no static brand.

  **`@forinda/kickjs-cli`**

  - `kick typegen` env-file detection regex broadened to match `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` / `loadEnvFromSchema(...)` in addition to the legacy `defineEnv(...)`. Projects migrating off `defineEnv` to the schema-agnostic loader no longer get a silent `kick/env: skipped`.
  - Env renderer flattens the kickjs-schema inference via a mapped-type identity (`type _Resolved = { [K in keyof _Raw]: _Raw[K] }`) so `interface KickEnv extends _Resolved {}` lands at an object type TS accepts. Without it, `InferSchemaOutput<typeof envSchema>` stays as a conditional type and the interface extension errors with TS2312 ("interface can only extend an object type with statically known members") even when the conditional resolves to a plain object.

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0
  - @forinda/kickjs-db@6.0.0-alpha.0

## 5.9.1

### Patch Changes

- Updated dependencies [[`53c3938`](https://github.com/forinda/kick-js/commit/53c39381ab6b30b95a67af9900969f4bad2506cc)]:
  - @forinda/kickjs@5.13.1
  - @forinda/kickjs-db@5.9.1

## 5.9.0

### Minor Changes

- [#278](https://github.com/forinda/kick-js/pull/278) [`64e5c2d`](https://github.com/forinda/kick-js/commit/64e5c2d28bc5b1fba92d0742d04def9c60d697bc) Thanks [@forinda](https://github.com/forinda)! - feat(cli): `kick doctor` — pre-flight checks for dev environment

  New CLI command that catches common "doesn't work on my machine" misconfigs before they bite. Sibling to `kick check --deploy` (which scans for production-readiness); doctor is the dev-setup counterpart.

  ```bash
  kick doctor
  ```

  Sample output:

  ```text
  KickJS Doctor

  ✔  Node version  (v22.7.0)
  ✔  @forinda/kickjs installed  (^5.12.0)
  ✔  express installed  (^5.1.0)
  ✔  reflect-metadata installed  (^0.2.2)
  ✔  tsconfig: experimentalDecorators
  ✔  tsconfig: emitDecoratorMetadata
  ✔  env wiring
  ✔  typegen freshness  (2m ago)

  8 passed, 0 warnings, 0 errors — your environment looks good
  ```

  Exit code is `0` on pass-or-warn, `1` on any error.

  **Built-in checks (this first pass):**

  | Check                              | Severity     | Detects                                                                                                                                                                                   |
  | ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Node version                       | error        | Node < 20                                                                                                                                                                                 |
  | `@forinda/kickjs` installed        | error        | Wrong directory / fresh repo                                                                                                                                                              |
  | `express` installed                | error        | Required peer dep missing                                                                                                                                                                 |
  | `reflect-metadata` installed       | error        | Decorator polyfill missing                                                                                                                                                                |
  | tsconfig: `experimentalDecorators` | error        | Decorators won't compile                                                                                                                                                                  |
  | tsconfig: `emitDecoratorMetadata`  | error        | DI container can't read constructor types                                                                                                                                                 |
  | env wiring                         | error / warn | env-init file (`src/env.ts`, `src/env/index.ts`, `src/config/env.ts`, `src/config/index.ts`) calls `loadEnv(...)` but the app entry doesn't import it — or imports it AFTER `bootstrap()` |
  | typegen freshness                  | warn         | `.kickjs/types/` last touched > 60 min ago                                                                                                                                                |

  The env-wiring check handles common file-location variations and accepts both relative (`'./env'`, `'./config/env'`) and `@/`-aliased (`'@/env'`, `'@/config'`) imports. Detects the canonical "ConfigService.get() returns undefined while @Value() works" footgun.

  **No ORM-specific checks in core.** The framework stays stack-agnostic — Prisma / Drizzle / Mongoose checks belong in adopter config (or in adapter packages that ship doctor extensions).

  **Extensibility — `defineDoctorExtension`:**

  ```ts
  // doctor-checks/prisma.ts (publishable as a package, or workspace-shared)
  import { defineDoctorExtension } from "@forinda/kickjs-cli";

  export const prismaDoctor = defineDoctorExtension({
    checks: [
      (ctx) => {
        // adopter-defined check; same DoctorContext + DoctorResult shape
        // as the built-ins. Return null to skip.
      },
    ],
  });

  // kick.config.ts
  import { defineConfig } from "@forinda/kickjs-cli";
  import { prismaDoctor } from "./doctor-checks/prisma";

  export default defineConfig({ doctor: prismaDoctor });
  ```

  Extra checks run after the built-ins, support async, and merge into the same summary output.

  **New exports from `@forinda/kickjs-cli`:**

  - `defineDoctorExtension(ext)` — identity helper for an extension bundle (mirrors `defineConfig`)
  - `defineDoctorCheck(check)` — identity helper for a single check
  - `DoctorExtension`, `DoctorCheck`, `DoctorContext`, `DoctorResult` — type contracts

  **Tests:** 29 new in `doctor.test.ts` covering all built-in checks, env-wiring variations (4 file locations × relative/alias imports × before/after bootstrap()), the extensibility hook (sync + async + null-skip), and both identity helpers.

  Closes B.4 from the roadmap.

### Patch Changes

- Updated dependencies [[`ace5e84`](https://github.com/forinda/kick-js/commit/ace5e8499b74a7b333fa6c6024f53ab5f5fd6ea8), [`a46927e`](https://github.com/forinda/kick-js/commit/a46927e9102ea67d25df633df2a55d782ab23a3c), [`7101444`](https://github.com/forinda/kick-js/commit/7101444c77d2eb3352f45db437401ff0ded0e1a6)]:
  - @forinda/kickjs@5.13.0
  - @forinda/kickjs-db@5.9.1

## 5.8.7

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

- Updated dependencies [[`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8)]:
  - @forinda/kickjs@5.12.1
  - @forinda/kickjs-db@5.9.1

## 5.8.6

### Patch Changes

- Updated dependencies [[`462681b`](https://github.com/forinda/kick-js/commit/462681bd4254f93046f59fe187518f2b86b0e94a)]:
  - @forinda/kickjs@5.12.0
  - @forinda/kickjs-db@5.9.0

## 5.8.5

### Patch Changes

- [#265](https://github.com/forinda/kick-js/pull/265) [`187eb0b`](https://github.com/forinda/kick-js/commit/187eb0b2ce93b56dcccdc68febab95ed600c0ae4) Thanks [@forinda](https://github.com/forinda)! - refactor(logger): drop pino dependency, default to `ConsoleLoggerProvider`

  `@forinda/kickjs` no longer ships pino or pino-pretty. The default logger is now `ConsoleLoggerProvider`, which routes through `console.*` and has zero runtime dependencies. The pluggable `LoggerProvider` interface is unchanged — adopters who want pino, winston, bunyan, or anything else implement the same five-method contract and call `Logger.setProvider()` before `bootstrap()`. See `docs/guide/logging.md` for Pino, Winston, and silent-logger recipes.

  **Behavioural change for adopters relying on the default**: log lines lose pino's JSON envelope and `pino-pretty` colors. The new format is `[ComponentName] message`. If you depend on pino's output shape (structured fields, transports, log-aggregator-friendly JSON), copy the ~15-line PinoProvider snippet from `docs/guide/logging.md` and call `Logger.setProvider(new PinoProvider())` at startup.

  **Removed exports**: the `rootLogger` re-export from `@forinda/kickjs` and the `PinoLoggerProvider` class. The `LoggerProvider` interface, `ConsoleLoggerProvider`, `Logger`, and `createLogger` are unchanged.

  **CLI scaffolds**: `kick new` no longer pre-installs `pino` / `pino-pretty`, and the generated `vite.config.ts` no longer needs `ssr.external: ['pino', 'pino-pretty']`. Existing projects keep working without changes.

- Updated dependencies [[`187eb0b`](https://github.com/forinda/kick-js/commit/187eb0b2ce93b56dcccdc68febab95ed600c0ae4)]:
  - @forinda/kickjs@5.11.0
  - @forinda/kickjs-db@5.9.0

## 5.8.4

### Patch Changes

- Updated dependencies [[`e53f833`](https://github.com/forinda/kick-js/commit/e53f83358304fddfd10840a9f5a1ab603f184a2f), [`fbe82c5`](https://github.com/forinda/kick-js/commit/fbe82c53082ae0c507b8e8ec85cd1fdbecb0e660)]:
  - @forinda/kickjs@5.10.0
  - @forinda/kickjs-db@5.9.0

## 5.8.3

### Patch Changes

- Updated dependencies [[`33e151b`](https://github.com/forinda/kick-js/commit/33e151b5cc9847254e91193edc05961aa0f7c931)]:
  - @forinda/kickjs@5.9.2
  - @forinda/kickjs-db@5.9.0

## 5.8.2

### Patch Changes

- [#258](https://github.com/forinda/kick-js/pull/258) [`0aa5c29`](https://github.com/forinda/kick-js/commit/0aa5c29c3a9bf9ce67d111ad3db1a6430253a8d8) Thanks [@forinda](https://github.com/forinda)! - fix(cli): `kick new` now emits the `.agents/` subfolder layout (was leaking the legacy flat layout)

  `kick g agents` was restructured to emit `CLAUDE.md` at the project root plus `.agents/AGENTS.md` / `.agents/GEMINI.md` / `.agents/COPILOT.md` and per-skill `.agents/skills/<slug>/SKILL.md` files, but `kick new`'s project initializer had its own emission path that was never updated — so a freshly scaffolded project came out with the legacy flat layout (`AGENTS.md` + `kickjs-skills.md` at the project root) regardless of the framework version. Two paths drifted; both should produce the same shape.

  The fix is one line: `initProject()` now delegates to `generateAgentDocs({ only: 'all', force: true })` instead of writing the three legacy files directly. The legacy `generateKickJsSkills` (deprecated since the per-skill split) is no longer called from the new-project path.

  Regression test in `kick-new-yes.test.ts`: spawn `kick new` and assert no `AGENTS.md` / `kickjs-skills.md` at the project root; assert `.agents/AGENTS.md` / `GEMINI.md` / `COPILOT.md` exist; assert at least one `.agents/skills/<slug>/SKILL.md` (covers the per-skill format).

  No CLI flag or option changes; the `kick new` surface is unchanged from the adopter's side. The fix only affects which files land where.

## 5.8.1

### Patch Changes

- [#254](https://github.com/forinda/kick-js/pull/254) [`d4bc212`](https://github.com/forinda/kick-js/commit/d4bc21292dedbb20ee1a952a43422a09afaf35fb) Thanks [@forinda](https://github.com/forinda)! - docs: README sweep — drop v4 references, switch examples to defineModule + factory shape, fix dead links

  Documentation-only patch bump so the updated READMEs ship to the npm-displayed package pages (npm always includes README.md in the tarball regardless of `files` field). No code or wire-format changes; safe to consume without changes.

  **`@forinda/kickjs`** — full rewrite of the README's getting-started. Was 60 lines using a `class implements AppModule` example with a deprecated `buildRoutes` import. Now walks through service → controller → module → registry → bootstrap in canonical v5 factory shape, with Zod validation, typed `Ctx<KickRoutes…>`, project-layout overview, and pointers to every relevant guide page.

  **`@forinda/kickjs-cli`** — add `bun` to the `--pm` flag list (the CLI's `kick new` prompt supports bun; the README was missing it).

  **`@forinda/kickjs-vite`** — fix dead doc link (`guide/vite-plugin` → `guide/hmr`; no `vite-plugin.md` exists, the HMR guide covers the plugin surface).

  **`@forinda/kickjs-auth`** — replace `kick add auth` install with `pnpm add @forinda/kickjs-auth`. The package was removed from the `kick add` registry; existing adopters who still depend on it install manually now, and the README points at the BYO Auth recipe for the canonical path forward.

  **`@forinda/kickjs-queue`** — list provider variants in the install section (`kick add queue:bullmq | rabbitmq | kafka | redis-pubsub`). README previously only mentioned BullMQ even though three other providers ship in the package.

  **`@forinda/kickjs-lint`** — scrub the stale v3 → v4 migration link suffix; point at the current DI Tokens guide instead.

  **`kickjs-devtools` (VS Code extension)** — disambiguate the naming collision with `@forinda/kickjs-devtools` (the runtime adapter that serves `/_debug/*`). Adds an explicit "VS Code editor extension, not the runtime adapter" callout, and recommends setting `secret: env.DEVTOOLS_SECRET` on the adapter for production gating.

  Root repo `README.md` is also rewritten (drop v4.2 banner, remove "Deprecated — going private in v5" table for packages already gone, switch Hello World to factory patterns, drop `kick g resolver` and `kick add auth` references, update `kick g agents` description to `.agents/` subfolder layout) — but that file isn't published, so it's a free-rider on this changeset.

- Updated dependencies [[`d4bc212`](https://github.com/forinda/kick-js/commit/d4bc21292dedbb20ee1a952a43422a09afaf35fb)]:
  - @forinda/kickjs@5.9.1
  - @forinda/kickjs-db@5.9.0

## 5.8.0

### Minor Changes

- [#250](https://github.com/forinda/kick-js/pull/250) [`1eed906`](https://github.com/forinda/kick-js/commit/1eed9066096cad9218ee4dcfd24f75adc7205b42) Thanks [@forinda](https://github.com/forinda)! - feat(cli): propagate `projectRoot` through `GeneratorContext` and `KickCliPluginContext`

  Both CLI contexts now carry a resolved `projectRoot` field alongside the existing `cwd`. Plugin authors and generator authors no longer need to call `findProjectRoot(cwd)` themselves to find the directory that owns `kick.config.*` — the value is resolved once at CLI startup and threaded through.

  **`GeneratorContext` (`packages/cli/src/generator-extension/define.ts`)**

  ```ts
  export interface GeneratorContext {
    // ...existing fields
    cwd: string; // where the CLI was invoked
    projectRoot: string; // resolved root via findProjectRoot()
  }
  ```

  `buildGeneratorContext` now accepts an optional `projectRoot`. When omitted it derives one from `cwd` via `findProjectRoot()` — zero-config for ad-hoc callers, free for the CLI entry which already resolved it.

  **`KickCliPluginContext` (`packages/cli/src/plugin/types.ts`)**

  ```ts
  export interface KickCliPluginContext {
    cwd: string; // invocation directory
    projectRoot: string; // resolved root
    config: KickConfig | null;
    log: (msg: string) => void;
    generators?: DiscoveredGenerator[];
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

### Patch Changes

- Updated dependencies [[`9f1e90e`](https://github.com/forinda/kick-js/commit/9f1e90e00160dfb3801e8bac451ace0aa7b3f37f), [`652a6bf`](https://github.com/forinda/kick-js/commit/652a6bf0dbac1c4c288fc921bb2782f28c1207a4)]:
  - @forinda/kickjs@5.9.0
  - @forinda/kickjs-db@5.9.0

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
    @Autowired(DB) private db1!: KickDbClient;
    @Inject(DB) private db2!: KickDbClient;

    // Constructor parameter position — both names work.
    constructor(
      @Autowired(LOGGER) private logger: Logger,
      @Inject(CACHE) private cache: Cache
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
  import { defineModules } from "@forinda/kickjs";
  import { HelloModule } from "./hello/hello.module";

  export const modules = defineModules().mount(HelloModule());
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
      style: "class", // pin to legacy class form; default is 'define'
    },
  });
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
  declare module "@forinda/kickjs-db" {
    interface KickDbRegister {
      db: KickDbClient<KickDbSchema>;
    }

    interface KickDbRelationsRegister {
      db: SchemaToRelationsRegister<typeof appSchema>;
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
  export const USER_REPOSITORY = createToken<IUserRepository>(
    "app/user/repository"
  );
  ```

  After:

  ```ts
  export const USER_REPOSITORY = createToken<IUserRepository>(
    "app/User/repository"
  );
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
