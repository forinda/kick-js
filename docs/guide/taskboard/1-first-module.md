---
description: Taskboard tutorial, part 1 — scaffold a KickJS app, generate a projects module, and see how the controller, service and repository split the work.
---

# Taskboard, Part 1: Your First Module

Over five parts you'll build **Taskboard**, a small team task tracker: projects, tasks, users, members and file attachments, on SQLite. This part scaffolds the app and adds a `projects` module that keeps its data in memory. By the end you can create and list projects over HTTP, and the tests pass.

## The five parts

1. **Your first module** — scaffold, the generated layout, a projects API in memory (this page).
2. [**A database**](./2-database.md) — kick/db on SQLite: schema, migrations, tasks, relational reads.
3. [**Authentication**](./3-authentication.md) — users, password hashing, sessions, protecting every route.
4. [**Teams and permissions**](./4-teams-permissions.md) — members and roles, transactions, 403 vs 404.
5. [**Attachments and shipping**](./5-attachments-shipping.md) — file uploads, cleanup after commit, a production build.

Each part ends with a working, tested app, so you can stop at any of them.

**You need** Node.js `^22.18.0 || >=24.11.0` (for the dev server) and a package manager — the commands below use pnpm, but npm, yarn and bun work too.

## Scaffold the app

<PmCommand dlx="@forinda/kickjs-cli new taskboard --template rest --packages devtools" />

```bash
cd taskboard
```

<PmCommand install />

`--template rest` sets up modules with a controller, service and repository each. `--packages devtools` adds the DevTools adapter, a dashboard for routes, requests and the DI container that you'll use below.

## What you got

```text
src/
  index.ts          # bootstrap(): modules, adapters, middleware
  config/index.ts   # the environment schema
  modules/
    index.ts        # the list of modules the app mounts
    hello/          # an example module — removed below
kick.config.ts      # CLI settings: pattern, module folder, custom commands
.env                # development values
.env.test           # read instead of .env under vitest
```

`src/index.ts` is the whole app in one call. It imports `./config` first, so the environment schema is registered before anything reads a value, then boots:

```ts
// src/index.ts
export const app = await bootstrap({
  modules,
  runtime: expressRuntime(),
  adapters: [DevToolsAdapter()],
  middlewares: [
    helmet(),
    cors({ origin: '*' }),
    requestId(),
    requestLogger(),
    // Express needs a body parser; Fastify and h3 parse bodies natively.
    express.json(),
  ],
})
```

The app runs on Express here; Fastify and h3 work the same way through `runtime` — see [HTTP runtimes](../http-runtimes.md). `src/config/index.ts` declares `PORT`, `NODE_ENV` and `LOG_LEVEL` with Zod; you'll add to it in Part 3. `.env.test` is read _instead of_ `.env` when tests run, with no fallback, so a test never quietly picks up a development value.

Start the dev server:

<PmCommand exec="kick dev" />

It serves on `http://localhost:3000` and reloads on save. It also runs `kick typegen` on every change, which writes the route types your handlers use — more on that in a moment.

## Generate the projects module

<PmCommand exec="kick g module project" />

The module name is pluralised for the folder and the URL, so this writes `src/modules/projects/` and mounts it at `/api/v1/projects`:

```text
src/modules/projects/
  project.module.ts       # registers the repository, declares the routes
  project.controller.ts   # HTTP: parse the request, call the service, return the result
  project.service.ts      # business logic
  project.repository.ts   # storage: factory, contract and DI token
  project.constants.ts    # which fields the list endpoint can filter, sort and search
  dtos/                   # request schemas and the response type
  __tests__/              # controller and repository tests
```

It also adds `.mount(ProjectModule())` to `src/modules/index.ts`. Each layer has one job, so the controller never touches storage and the repository never sees HTTP.

### The controller

```ts
// src/modules/projects/project.controller.ts
@Controller()
export class ProjectController {
  @Autowired() private readonly projectService!: ProjectService

  @Get('/')
  @ApiQueryParams(PROJECT_QUERY_CONFIG)
  async list(ctx: Ctx<KickRoutes.ProjectController['list']>) {
    return ctx.paginate((parsed) => this.projectService.findPaginated(parsed), PROJECT_QUERY_CONFIG)
  }

  @Get('/:id')
  async getById(ctx: Ctx<KickRoutes.ProjectController['getById']>) {
    const result = await this.projectService.findById(ctx.params.id)
    if (!result) {
      ctx.problem.notFound({ detail: `Project ${ctx.params.id} not found` })
      return
    }
    return result
  }

  @Post('/', { body: createProjectSchema, name: 'CreateProject' })
  async create(ctx: Ctx<KickRoutes.ProjectController['create']>) {
    return reply.created(await this.projectService.create(ctx.body))
  }

  // update (PUT /:id) and remove (DELETE /:id) follow the same shape
}
```

Three conventions to notice:

- **`Ctx<KickRoutes.ProjectController['create']>`** types `ctx.params`, `ctx.body` and `ctx.query` for that route. `KickRoutes` is generated by [typegen](../typegen.md) from your decorators and schemas, so `ctx.body` is exactly what `createProjectSchema` accepts.
- **Handlers return their payload.** The runtime sends it as JSON, and typegen reads the return type — that's what lets the [typed client](../typed-client.md) know what each route answers. `reply.created(...)` and `reply.noContent()` carry a status other than 200.
- **Errors go through `ctx.problem`**, which answers with an [RFC 9457](../error-handling.md) `problem+json` body and returns nothing, so the 404 stays out of the route's success type.

### The repository and its contract

```ts
// src/modules/projects/project.repository.ts
export function createProjectRepository() {
  const store = new Map<string, ProjectResponseDTO>()

  return {
    async findById(id: string): Promise<ProjectResponseDTO | null> {
      return store.get(id) ?? null
    },
    async create(dto: CreateProjectDTO): Promise<ProjectResponseDTO> {
      const now = new Date().toISOString()
      const entity = {
        id: randomUUID(),
        ...dto,
        createdAt: now,
        updatedAt: now,
      } as ProjectResponseDTO
      store.set(entity.id, entity)
      return entity
    },
    // findAll, findPaginated, update, delete …
  }
}

/** The contract, derived from the factory rather than declared beside it. */
export type ProjectRepository = ReturnType<typeof createProjectRepository>

export const PROJECT_REPOSITORY = createToken<ProjectRepository>('taskboard/Project/repository')
```

The repository is a plain factory, and its type _is_ the contract: `ProjectRepository` is whatever the factory returns, so the interface and the implementation can't drift apart. The module binds it to a token:

```ts
// src/modules/projects/project.module.ts
register(container) {
  container.registerFactory(PROJECT_REPOSITORY, () => createProjectRepository())
},
```

and the service asks for the token, not the implementation:

```ts
// src/modules/projects/project.service.ts
@Service()
export class ProjectService {
  constructor(@Inject(PROJECT_REPOSITORY) private readonly repo: ProjectRepository) {}
  // findById, findPaginated, create, update, delete — each delegates to this.repo
}
```

This is the seam the rest of the tutorial leans on. In Part 2 you replace the body of `createProjectRepository` with database queries, and neither the service nor the controller changes. Tokens are covered in [Dependency Injection](../dependency-injection.md).

### DTOs and query config

The request schemas are Zod:

```ts
// src/modules/projects/dtos/create-project.dto.ts
export const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
})

export type CreateProjectDTO = z.infer<typeof createProjectSchema>
```

Passing it as `@Post('/', { body: createProjectSchema })` validates every request before the handler runs. `project.constants.ts` lists which fields the list endpoint may filter, sort and search by — `ctx.paginate` reads `?page=`, `?limit=`, `?sort=` and friends against it ([Query Parsing](../query-parsing.md)):

```ts
export const PROJECT_QUERY_CONFIG: QueryFieldConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
```

## Remove the hello module

The scaffold's `hello` module was only there to prove the app boots. Delete `src/modules/hello/` and its two lines in `src/modules/index.ts`:

```ts
// src/modules/index.ts
import { defineModules } from '@forinda/kickjs'
import { ProjectModule } from './projects/project.module'

export const modules = defineModules().mount(ProjectModule())
```

## Try it

```bash
curl -X POST localhost:3000/api/v1/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Launch"}'
# 201 {"id":"…","name":"Launch","createdAt":"…","updatedAt":"…"}

curl localhost:3000/api/v1/projects
# 200 {"data":[{"id":"…","name":"Launch",…}],"meta":{"page":1,"limit":…,"total":1,…}}

curl -X POST localhost:3000/api/v1/projects \
  -H 'content-type: application/json' \
  -d '{"name":""}'
# 422 {"status":422,"detail":"Name is required","errors":[{"field":"name","message":"Name is required"}],…}
```

The invalid body never reaches your handler: validation answers `422` with the failing field.

Open `http://localhost:3000/_debug` in a browser. The [DevTools](../devtools.md) dashboard lists every route with its method and path, the recent requests, and what's registered in the container — `taskboard/Project/repository` among them.

Restart the dev server and the project you created is gone: it lived in a `Map`. Part 2 fixes that.

## Run the tests

<PmCommand run="test" />

The generated repository test exercises the in-memory store directly. The controller test boots the module with `createTestApp` and drives it with supertest:

```ts
const { app } = await createTestApp({ modules: [ProjectModule()] })
const res = await request(app.handle.bind(app)).get('/api/v1/projects')
expect(res.status).toBe(200)
```

The other controller cases are generated as `it.todo(...)` — the reporter lists them as outstanding rather than counting them as passes. They're a checklist: fill them in as you change each endpoint. [Testing](../testing.md) covers `createTestApp` in full.

## What you built

- A KickJS app on Express with DevTools.
- A `projects` module: controller, service, and a repository behind a DI token.
- Request validation from a Zod schema, with `422` problem responses.
- Typed handlers from generated route types.
- Passing tests, plus a list of the ones still to write.

**Next:** [Part 2 — A database](./2-database.md), where the repository moves to SQLite and tasks arrive.
