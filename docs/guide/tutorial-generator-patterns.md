# KickJS Module Generator: Two Patterns for Every Backend Need

**Tags:** kickjs, typescript, nodejs, architecture

---

One of the things I appreciate most about working with a framework is when it meets me where I am. Not every feature I build needs the same level of ceremony. A health check endpoint does not need a service, a repository, and three DTOs. A real CRUD resource that talks to a database does. The KickJS module generator understands this distinction, and it changed how I think about scaffolding backend code.

The command is simple:

```bash
kick g module <name> --pattern <pattern>
```

That `--pattern` flag is where the decision lives. KickJS ships **two** architecture patterns: `rest` (the default) and `minimal`. Each one generates a different number of files with a different structural philosophy. Instead of forcing you into one way of building modules, the generator lets you pick the right level of complexity for the job at hand.

::: tip
Earlier versions of KickJS also shipped `ddd` and `cqrs` patterns. Those have been **removed** — the generator now focuses on two well-defined shapes: a flat, batteries-included `rest` module and a bare `minimal` module. If you need layered DDD/CQRS boundaries, build them on top of `rest` by hand.
:::

All directory layouts below reflect the **default** that `kick g module` writes. The generator reads `kick.config.ts > modules.dir` (default `src/modules`) for the project root and respects per-invocation overrides — none of these paths are framework-enforced.

## Pattern 1: rest (the default)

```bash
kick g module cats                  # rest is the default
kick g module cats --pattern rest  # same thing, explicit
```

This is the workhorse pattern. It covers the full CRUD lifecycle in a flat folder under `src/modules/<plural>/` — no subdirectories to navigate, everything for the module in one place:

```
cats/
├── cats.module.ts
├── cats.controller.ts
├── cats.service.ts
├── cats.constants.ts              # query config
├── cats.repository.ts             # factory + contract + DI token, one file
├── dtos/
│   ├── create-cat.dto.ts
│   ├── update-cat.dto.ts
│   └── cat-response.dto.ts
└── __tests__/
    ├── cats.controller.test.ts
    └── cats.repository.test.ts
```

The service wraps the repository, the controller delegates to the service, and the DTOs handle validation. The module file (`cats.module.ts`) wires it all together with `defineModule` and eagerly loads the decorated classes:

```ts
import { defineModule } from '@forinda/kickjs'
import { CAT_REPOSITORY, createCatRepository } from './cats.repository'
import { CatsController } from './cats.controller'

// Eagerly load decorated classes so @Service()/@Repository() register in the DI container
import.meta.glob(['./**/*.service.ts', './**/*.repository.ts', '!./**/*.test.ts'], { eager: true })

export const CatsModule = defineModule({
  name: 'CatsModule',
  build: () => ({
    register(container) {
      container.registerFactory(CAT_REPOSITORY, () => createCatRepository())
    },
    routes() {
      return {
        path: '/cats',
        controller: CatsController,
      }
    },
  }),
})
```

You get a working module the instant the generator finishes — no database setup required. The `register()` method binds the repository token to the in-memory implementation; swapping in a real persistence layer later is a one-line change to that factory.

**When to use it:** Most CRUD resources, real features with persistence, anything where you want a service/repository boundary and request/response DTOs out of the box. This is the pattern I reach for most often, and it is the default for a reason.

## Pattern 2: minimal

```bash
kick g module health --pattern minimal
kick g module health --minimal          # shorthand
```

This is the lightest possible module. Two files. That is it.

```
health/
├── health.module.ts
└── health.controller.ts
```

The module file is bare — it implements `defineModule`, registers nothing in the DI container, and points a single route set at the controller:

```ts
import { defineModule } from '@forinda/kickjs'
import { HealthController } from './health.controller'

export const HealthModule = defineModule({
  name: 'HealthModule',
  build: () => ({
    routes() {
      return {
        path: '/health',
        controller: HealthController,
      }
    },
  }),
})
```

The controller is equally lean. No service, no repository, no DTOs — just decorated route handlers:

```ts
import { Controller, Get, type Ctx } from '@forinda/kickjs'

@Controller()
export class HealthController {
  @Get('/')
  async list(ctx: Ctx<KickRoutes.HealthController['list']>) {
    ctx.json({ status: 'ok', timestamp: new Date().toISOString() })
  }
}
```

The `Ctx<KickRoutes.HealthController['list']>` type comes from `kick typegen`, which runs automatically on `kick dev`. See the [typegen guide](./typegen.md) for details.

Use the minimal pattern for endpoints that do not touch a database or need business logic: health checks, version endpoints, static configuration responses, debug routes, quick prototypes, or any time you would rather wire your own structure than start from the full REST layout.

**When to use it:** Tiny endpoints, spikes, prototypes, or modules where a controller alone is sufficient and you will grow your own structure from there.

## Choosing a pattern

| Scenario                                    | Pattern   | Why                                                      |
| ------------------------------------------- | --------- | -------------------------------------------------------- |
| Standard CRUD resource with persistence     | `rest`    | Service + repository + DTOs + tests, ready to run        |
| Health check, version, static endpoint      | `minimal` | Two files, zero ceremony                                 |
| Prototype / spike                           | `minimal` | Prove the concept first, promote to `rest` when it grows |
| You want to design your own internal layers | `minimal` | Start bare and add structure on your terms               |

The two patterns are not mutually exclusive within a project — you can have a `minimal` stats endpoint sitting next to a fully scaffolded `rest` resource. Start with whichever fits the module, and re-run the generator (or grow the files by hand) when the shape changes.

## Setting the default pattern

`kick g module <name>` defaults to `rest`. To change the project-wide default, set `pattern` in `kick.config.ts`:

```ts
import { defineConfig } from '@forinda/kickjs-cli/config'

export default defineConfig({
  pattern: 'rest', // 'rest' | 'minimal'
  modules: {
    dir: 'src/modules',
    repo: 'inmemory',
    pluralize: true,
  },
})
```

The `--pattern` flag on any individual `kick g module` call overrides the config value for that one invocation. (`--minimal` is shorthand for `--pattern minimal`.)

## Repositories: one file, whatever the name

The `rest` pattern generates **one** repository file, `cats.repository.ts`, holding the factory, the contract and the DI token. `--repo` (or `modules.repo` in config) no longer changes the file name, the identifiers, or the shape:

```bash
kick g module cats                    # cats.repository.ts — working Map body
kick g module cats --repo postgres    # cats.repository.ts — unimplemented, "write the postgres query"
```

::: warning `modules.repo` is deprecated
The name no longer changes the generated code. It survives only as **prose** — the store appears in the stub's comments and in its "not implemented" errors, as a note to whoever writes the query. Set it for that hint, or leave it unset and get the in-memory implementation. It keeps working, and will not be removed without a replacement.
:::

There are two outcomes, and the difference is the body, not the name:

- **unset / `inmemory`** — a zero-dependency, fully working `Map`-backed factory. Run and test the module immediately.
- **any other name** — the same file with an unimplemented body and TODOs where you wire your client.

**The store name is deliberately absent from the identifiers.** The generator used to emit `postgres-cats.repository.ts` exporting `PostgresCatsRepository` — whose every method read and wrote a `Map`. An app could be wired, booted and manually tested against a class asserting Postgres while every write went to a store that empties on restart, with nothing in the types or the logs to say so. The name was the lie, not the Map.

### How the factory, contract and token fit together

All three live in one file, `cats.repository.ts`. The factory is the implementation; the contract is **derived from it** rather than declared beside it, so the two cannot drift:

```ts
import { createToken, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { CatResponseDTO } from './dtos/cat-response.dto'
import type { CreateCatDTO } from './dtos/create-cat.dto'
import type { UpdateCatDTO } from './dtos/update-cat.dto'

export function createCatRepository() {
  const store = new Map<string, CatResponseDTO>()

  return {
    async findById(id: string) {
      return store.get(id) ?? null
    },
    // ...findAll, findPaginated, create, update, delete
  }
}

/** The contract, derived from the factory rather than declared beside it. */
export type CatRepository = ReturnType<typeof createCatRepository>

/**
 * Collision-safe DI token bound to `CatRepository`.
 * `container.resolve(CAT_REPOSITORY)` and `@Inject(CAT_REPOSITORY)` both
 * return the typed contract — no manual generic, no `any` cast.
 */
export const CAT_REPOSITORY = createToken<CatRepository>('app/Cat/repository')
```

There is no `I`-prefixed interface, no `@Repository()` class, and no separate implementation file. The store name is not in any identifier either: an in-memory body under a name like `PostgresCatRepository` was a lie the types could not catch, so the name says what it is and the TODO says what to swap in.

The module's `register()` binds the **token** to the **factory**, and the service depends only on the token:

```ts
container.registerFactory(CAT_REPOSITORY, () => createCatRepository())
```

Swapping in a real database later means changing that one line — the controller, service and DTOs never change. (The `'app/'` token prefix tracks your project's `tokenScope`, so `kick-lint`'s reserved-prefix rule never fires.)

::: tip One file, whatever the repo name
`--repo postgres` no longer changes the generated code or the file name. You get the same `cats.repository.ts` with an in-memory body and a TODO — which runs, so the generated `__tests__` have something real to exercise while you fill in the driver.
:::

## Wiring a real database

The generator produces one repository shape regardless of `--repo`: a factory with an in-memory body and a TODO. It deliberately does **not** generate ORM-specific data-access code — you own the integration behind the boundary.

When you're ready for a real database, the first-party option is `@forinda/kickjs-db` — the PostgreSQL, SQLite and MySQL dialects ship as subpaths of it (`@forinda/kickjs-db/pg`, `/sqlite`, `/mysql`):

```bash
kick add db
pnpm add pg # or better-sqlite3 / mysql2
```

Replace the factory body with calls against your client — the exported `<Name>Repository` type follows automatically, since it is the factory's return type. The generator hands you the boundary; you decide what runs behind it.

## Field-aware scaffolding: `kick g scaffold`

When you already know the shape of a resource, `kick g scaffold` emits the **flat REST layout** with DTOs derived from your field definitions — no hand-editing the generated `create`/`update`/`response` DTOs:

```bash
kick g scaffold Post title:string body:text:optional published:boolean:optional
```

This produces the same flat `rest` tree (module, controller, service, constants, repository interface + token, in-memory repository, `dtos/`, `__tests__/`), but the DTOs and types are generated from your fields. Supported field types include:

```
string, text, number, int, float, boolean, date, email, url, uuid, json, enum:a,b,c
```

Mark a field optional with any of three equivalent syntaxes — `:optional` is the shell-safe one that needs no quoting:

```bash
kick g scaffold Post body:text:optional      # recommended
kick g scaffold Post "body:text?"            # needs quoting
kick g scaffold Post "body?:text"            # needs quoting
```

Useful flags: `--no-tests` (skip the `__tests__/`), `--no-pluralize` (use singular names), and `--modules-dir <dir>` (override the target directory).

::: tip
`kick g scaffold` always emits the REST layout — it is the field-aware front door to the same structure `kick g module --pattern rest` produces. (The DDD layout this command used to generate was removed alongside the `ddd`/`cqrs` patterns.)
:::

## Auto-wiring: the generator updates your module registry

When you run `kick g module` (or `kick g scaffold`), the generator does not just create files — it also registers the new module so its routes actually mount. Module files are named `<name>.module.ts` precisely so Vite's module-discovery plugin picks them up automatically, and the eager `import.meta.glob` inside each REST module ensures every `@Service()` / `@Repository()` decorated class registers itself in the DI container as a side effect of being imported.

This matters more than it sounds: forgetting to register a module is the kind of bug that gives you no error message — your routes simply do not exist, and you spend twenty minutes wondering why your client gets a 404.

## Wrapping up

The `kick g module` command is a small decision framework. Two patterns, one question: does this feature need a service, a repository, and DTOs, or is a controller enough?

- Reach for **`rest`** (the default) for real resources with persistence — you get the full CRUD scaffold and a clean repository interface boundary.
- Reach for **`minimal`** for tiny endpoints, prototypes, or when you want to grow your own structure.

Pick your persistence by **name**: `inmemory` for a working impl out of the box, or any DB name for a stub you wire to your own client (reach for `@forinda/kickjs-db` when you want the first-party database layer).

```bash
# Standard CRUD resource (default)
kick g module cats

# A bare endpoint
kick g module health --pattern minimal

# A resource you already know the shape of
kick g scaffold post title:string body:text:optional published:boolean:optional

# A resource backed by your own Postgres client
kick g module orders --repo postgres
```

Two patterns, one framework, the right amount of ceremony for each module. That is the kind of flexibility I want in a backend toolkit.
