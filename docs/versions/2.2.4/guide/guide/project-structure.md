# Project Structure

## New Project

Running `kick new my-api` scaffolds a complete project:

```text
my-api/
  src/
    index.ts                  # Entry point — calls bootstrap()
    modules/
      index.ts                # Exports the modules array
      hello/                  # Sample module
        index.ts
        hello.controller.ts
        hello.service.ts
  vite.config.ts              # Vite config with kickjsVitePlugin()
  kick.config.ts              # CLI configuration (pattern, repo, modules dir)
  vitest.config.ts            # Test runner config
  tsconfig.json
  package.json
  .env / .env.example
  CLAUDE.md / AGENTS.md       # AI development guides
  README.md
```

## Entry Point

```ts
// src/index.ts
import express from 'express'
import { bootstrap, helmet, cors, requestId, requestLogger } from '@forinda/kickjs'
import { modules } from './modules'

export const app = bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,
  middleware: [
    helmet(),
    cors({ origin: ['https://app.example.com'] }),
    requestId(),
    requestLogger(),
    express.json(),
  ],
})

// Production: start the server directly
if (process.env.NODE_ENV === 'production') {
  app.start()
}
```

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

KickJS supports four module patterns. Set the pattern in `kick.config.ts` or use the `--pattern` flag:

```bash
kick g module users                    # Uses kick.config.ts pattern (default: ddd)
kick g module users --pattern minimal  # Override pattern
```

### Minimal

Bare-bones controller. Perfect for prototyping.

```text
src/modules/users/
  index.ts
  users.controller.ts
```

### REST

Flat structure with service and repository separation.

```text
src/modules/users/
  index.ts
  users.constants.ts
  users.controller.ts
  users.service.ts
  users.repository.ts                # Interface + DI token
  inmemory-users.repository.ts       # Default implementation
  dtos/
    create-users.dto.ts
    update-users.dto.ts
    users-response.dto.ts
  __tests__/
    users.controller.test.ts
    users.repository.test.ts
```

### DDD (Domain-Driven Design)

Full vertical layering with domain, application, infrastructure, and presentation layers.

```text
src/modules/users/
  index.ts
  constants.ts
  presentation/
    users.controller.ts
  application/
    dtos/
      create-users.dto.ts
      update-users.dto.ts
      users-response.dto.ts
    use-cases/
      create-users.use-case.ts
      update-users.use-case.ts
      get-users.use-case.ts
      list-users.use-case.ts
      delete-users.use-case.ts
  domain/
    entities/
      users.entity.ts
    value-objects/
      users-id.vo.ts
    repositories/
      users.repository.ts            # Interface only
    services/
      users-domain.service.ts
  infrastructure/
    repositories/
      inmemory-users.repository.ts    # Concrete implementation
  __tests__/
    users.controller.test.ts
    users.repository.test.ts
```

### CQRS (Command Query Responsibility Segregation)

Event-driven pattern with explicit commands, queries, and domain events.

```text
src/modules/users/
  index.ts
  users.constants.ts
  users.controller.ts                 # Dispatches commands/queries
  users.repository.ts                 # Interface
  inmemory-users.repository.ts        # Implementation
  dtos/
    create-users.dto.ts
    update-users.dto.ts
    users-response.dto.ts
  commands/
    create-users.command.ts
    update-users.command.ts
    delete-users.command.ts
  queries/
    get-users.query.ts
    list-users.query.ts
  events/
    users-created.event.ts
    users-updated.event.ts
    users-deleted.event.ts
  __tests__/
    users.controller.test.ts
    users.repository.test.ts
```

### Choosing a Pattern

| Pattern | Best for | Complexity |
|---------|----------|------------|
| **Minimal** | Scripts, prototyping, learning | Low |
| **REST** | Standard CRUD APIs, traditional layered apps | Medium |
| **DDD** | Complex business logic, domain-heavy applications | High |
| **CQRS** | Event-driven systems, high-throughput writes | High |

## Generated Module Index

Each generated module uses `import.meta.glob` to eagerly load decorated classes. This ensures `@Service()` and `@Repository()` decorators fire and register in the DI container without manual imports:

```ts
// DDD pattern — src/modules/users/index.ts
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { USERS_REPOSITORY } from './domain/repositories/users.repository'
import { InMemoryUsersRepository } from './infrastructure/repositories/inmemory-users.repository'
import { UsersController } from './presentation/users.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class UsersModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(USERS_REPOSITORY, () =>
      container.resolve(InMemoryUsersRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UsersController),
      controller: UsersController,
    }
  }
}
```

The REST pattern uses a broader glob since files are flat:

```ts
// REST pattern — eagerly loads services and repositories
import.meta.glob(['./**/*.service.ts', './**/*.repository.ts', '!./**/*.test.ts'], { eager: true })
```

You can also use plain side-effect imports instead of `import.meta.glob` if you prefer explicit imports.

## Module Composition

Modules are self-contained and composed via the `modules` array:

```ts
// src/modules/index.ts
import type { AppModuleClass } from '@forinda/kickjs'
import { TodoModule } from './todos'
import { OrderModule } from './orders'

export const modules: AppModuleClass[] = [TodoModule, OrderModule]
```

Routes are mounted at `/{apiPrefix}/v{version}{path}`, so a module with `path: '/todos'` becomes `/api/v1/todos`.

## Repository Options

All patterns (except minimal) support swapping the repository implementation:

```bash
kick g module users --repo inmemory    # Default — in-memory store
kick g module users --repo prisma      # Prisma ORM
kick g module users --repo drizzle     # Drizzle ORM
```

The module's `register()` method binds the interface token to the implementation. Swap implementations by changing the factory target — no other code changes needed:

```ts
container.registerFactory(USER_REPOSITORY, () =>
  container.resolve(InMemoryUserRepository),  // ← change this line
)
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
