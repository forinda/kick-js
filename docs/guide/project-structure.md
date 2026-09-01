# Project Structure

## New Project

Running `kick new my-api` scaffolds a complete project. The layout below is the **default convention** — paths like `src/modules/`, `src/config/`, and the entry file are configurable. Generators read `kick.config.ts` for the live values, so adopters who relocate or rename directories don't fight the toolchain.

```text
my-api/                           # Default layout — adopters can rearrange
├── src/
│   ├── config/
│   │   └── index.ts              # Env schema (defineEnv + loadEnv)
│   ├── index.ts                  # Entry point — calls bootstrap()
│   └── modules/                  # modules.dir in kick.config.ts (default 'src/modules')
│       ├── hello/                # Sample module
│       │   ├── hello.controller.ts
│       │   ├── hello.module.ts
│       │   └── hello.service.ts
│       └── index.ts              # Exports the modules array
├── .agents/                      # AI-agent docs (kick g agents regenerates)
│   ├── AGENTS.md                 # Canonical multi-agent reference (Copilot, Codex, …)
│   ├── COPILOT.md
│   ├── GEMINI.md
│   └── skills/<slug>/SKILL.md    # One folder per skill, auto-discovered by agents
├── .kickjs/types/                # kick typegen output (KickRoutes, KickEnv, …)
├── .env / .env.example / .env.test
├── .editorconfig
├── .gitattributes / .gitignore
├── .oxfmtrc.json                 # Formatter config
├── CLAUDE.md                     # Root by convention — thin pointer to .agents/AGENTS.md
├── README.md
├── kick.config.ts                # CLI configuration (pattern, repo, modules dir)
├── package.json
├── tsconfig.json
├── vite.config.ts                # Vite config with kickjsVitePlugin()
└── vitest.config.ts              # Test runner config
```

## Entry Point

```ts
// src/index.ts
import 'reflect-metadata'
// Side-effect import — registers the env schema BEFORE any @Value() resolves.
import './config'
import express from 'express'
import { bootstrap, expressRuntime, helmet, cors, requestId, requestLogger } from '@forinda/kickjs'
import { modules } from './modules'

// Exported for the Vite plugin in dev mode.
export const app = await bootstrap({
  modules,
  runtime: expressRuntime(),
  middlewares: [
    helmet(),
    cors({ origin: ['https://app.example.com'] }),
    requestId(),
    requestLogger(),
    express.json(), // Express only — Fastify and h3 parse bodies natively
  ],
})
```

`bootstrap()` is async — `await` it. On Fastify or h3 the generator swaps `expressRuntime()` for `fastifyRuntime()` (from `@forinda/kickjs/fastify`) or `h3Runtime()` (from `@forinda/kickjs/h3`), and drops the `express.json()` line — those engines parse bodies natively.

## Dev Mode

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { kickjsVitePlugin } from '@forinda/kickjs-vite'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [
    swc.vite({ tsconfigFile: 'tsconfig.json' }),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
  ],
})
```

```bash
pnpm kick dev     # Vite HMR — instant rebuilds, preserved DB/Redis/WS state
pnpm kick build   # Production build
pnpm kick start   # Production server (Vite not used at runtime)
```

## Module Patterns

KickJS supports two module patterns. Set the pattern in `kick.config.ts` or use the `--pattern` flag:

```bash
kick g module users                    # Uses kick.config.ts pattern (default: rest)
kick g module users --pattern minimal  # Override pattern
```

The trees below show the **default** layout each pattern writes under `modules.dir` (default `src/modules`). The directory roots are conventional — relocate them via `kick.config.ts > modules.dir` and the generator follows.

### Minimal

Bare-bones controller. Perfect for prototyping.

```text
src/modules/users/
  users.module.ts
  users.controller.ts
```

### REST (default)

Flat structure with service and repository separation.

```text
src/modules/users/
  users.module.ts
  users.constants.ts
  users.controller.ts
  users.service.ts
  users.repository.ts                # Factory + contract + DI token, one file
  dtos/
    create-users.dto.ts
    update-users.dto.ts
    users-response.dto.ts
  __tests__/
    users.controller.test.ts
    users.repository.test.ts
```

The repository is **one file**: `createUsersRepository()` is the factory, its
return type _is_ the contract, and the DI token sits alongside it. It ships
backed by a `Map`, so a fresh module runs as generated. With a custom repo name
(e.g. `--repo postgres`) the same file is emitted as a stub with TODO markers —
you replace the factory body and nothing else changes, because the contract is
whatever the factory returns.

Pass `--no-tests` to skip the `__tests__/` pair.

### Choosing a Pattern

| Pattern     | Best for                                      | Complexity |
| ----------- | --------------------------------------------- | ---------- |
| **Minimal** | Scripts, prototyping, learning                | Low        |
| **REST**    | Standard CRUD APIs, layered service/repo apps | Medium     |

## Generated Module Declaration

Each generated module uses `import.meta.glob` to eagerly load decorated classes. This ensures `@Service()` and `@Repository()` decorators fire and register in the DI container without manual imports:

```ts
// REST pattern — src/modules/users/users.module.ts
import { defineModule } from '@forinda/kickjs'
import { USERS_REPOSITORY, createUsersRepository } from './users.repository'
import { UsersController } from './users.controller'

// Eagerly load every module file so decorators (@Controller / @Service /
// @Repository, and anything you add) register in the DI container. The glob is
// deliberately broad — a suffix list missed hand-written *.usecase.ts / *.policy.ts
// files, which then failed at resolve time as `No provider for X` (#609).
import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./**/*.d.ts'], { eager: true })

export const UsersModule = defineModule({
  name: 'UsersModule',
  build: () => ({
    register(container) {
      container.registerFactory(USERS_REPOSITORY, () => createUsersRepository())
    },
    routes() {
      return {
        path: '/users',
        controller: UsersController, // framework derives the router via buildRoutes()
      }
    },
  }),
})
```

You can also use plain side-effect imports instead of `import.meta.glob` if you prefer explicit imports.

## Module Composition

Modules are self-contained and composed via the `modules` array:

```ts
// src/modules/index.ts
import { defineModules } from '@forinda/kickjs'
import { TodoModule } from './todos/todo.module'
import { OrderModule } from './orders/order.module'

// `defineModules()` returns a chainable list — `kick g module` appends a
// `.mount(NewModule())` call on every generation. The `defineModule` factories
// are invoked at the registration site, producing the AppModule instances
// bootstrap registers.
export const modules = defineModules().mount(TodoModule()).mount(OrderModule())
```

A plain `AppModuleEntry[]` array still works if you prefer it — the generator
just can't append to it automatically.

Routes are mounted at `/{apiPrefix}/v{version}{path}`, so a module with `path: '/todos'` becomes `/api/v1/todos`.

## Repository Options

The REST pattern supports swapping the repository implementation by name. `inmemory` is the only built-in (a working in-memory store); any other name scaffolds a generic custom-repository stub with TODO markers:

```bash
kick g module users --repo inmemory    # Default — working in-memory store
kick g module users --repo postgres    # Same file, emitted as a stub with TODOs
kick g module users --repo mongo       # Same file, emitted as a stub with TODOs
```

The module's `register()` binds the token to the factory, so swapping the store
means editing the factory body in `users.repository.ts` — the binding never
changes:

```ts
container.registerFactory(USERS_REPOSITORY, () => createUsersRepository())
```

## Testing

Tests live in `__tests__/` directories colocated with the code they test:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

describe('UserController', () => {
  beforeEach(() => Container.reset())

  it('lists users', async () => {
    const { expressApp } = await createTestApp({ modules: [UserModule] })
    const res = await request(expressApp).get('/api/v1/users')
    expect(res.status).toBe(200)
  })
})
```

Run tests with `pnpm test` or `pnpm kick test`.
