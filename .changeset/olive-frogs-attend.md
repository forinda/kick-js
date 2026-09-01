---
'@forinda/kickjs': patch
'@forinda/kickjs-cli': patch
---

Fix isolated containers resolving nothing, and a glob that missed half a module.

**`Container.create()` returned a container with no decorator registrations
(#608).** Decorators register at class-definition time into whichever container
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

**The generated module's eager glob only matched three suffixes (#609).** It
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
