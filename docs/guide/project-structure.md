# Project Structure

KickJS uses a monorepo layout with a Domain-Driven Design (DDD) module structure inside each application. The CLI command `kick g module <name>` scaffolds the full module with all layers.

## Monorepo Layout

```
kick-js/
  packages/
    core/         # DI container, decorators, interfaces
    http/         # Express integration, routing, middleware, bootstrap
    cli/          # Code generators (kick g module, kick g controller, ...)
    swagger/      # OpenAPI spec generation adapter
    config/       # Configuration loading
    testing/      # Test utilities
  examples/
    basic-api/    # Reference application
```

Each package is published under the `@kickjs/` scope. Applications import from `@kickjs/core` and `@kickjs/http`.

## Application Layout

A typical application follows this structure:

```
src/
  index.ts                  # Entry point — calls bootstrap()
  modules/
    index.ts                # Exports the modules array
    todos/
      index.ts              # AppModule implementation
      presentation/
        todo.controller.ts  # HTTP handlers
      application/
        dtos/               # Zod schemas for request validation
        use-cases/          # Single-purpose orchestration classes
      domain/
        entities/           # Core business objects
        value-objects/      # Typed wrappers (IDs, emails, etc.)
        repositories/       # Interface + DI token (Symbol)
        services/           # Cross-entity business rules
      infrastructure/
        repositories/       # Concrete implementations (in-memory, Drizzle, Prisma)
```

## DDD Layers

### Presentation

Controllers decorated with `@Controller()`. They receive a `RequestContext`, delegate to use cases, and return responses. No business logic lives here.

### Application

Use cases and DTOs. Each use case is a `@Service()` class with a single `execute()` method. DTOs are Zod schemas that validate incoming data and generate TypeScript types via `z.infer`.

### Domain

Entities, value objects, repository interfaces, and domain services. This layer has no framework dependencies. Repository interfaces are defined here with a `Symbol` token for DI binding:

```ts
export interface ITodoRepository {
  findById(id: string): Promise<TodoResponseDTO | null>
  findAll(): Promise<TodoResponseDTO[]>
  create(dto: CreateTodoDTO): Promise<TodoResponseDTO>
}

export const TODO_REPOSITORY = Symbol('ITodoRepository')
```

### Infrastructure

Concrete repository implementations. The module's `register()` method binds the interface token to the implementation:

```ts
container.registerFactory(TODO_REPOSITORY, () =>
  container.resolve(InMemoryTodoRepository),
)
```

Swap implementations by changing the factory target -- no other code needs to change.

## Generating a Module

```bash
kick g module order
```

This creates the full `src/modules/orders/` directory with all layers, a CRUD controller, Zod DTOs, use cases, a repository interface, and an in-memory implementation. It also auto-registers the module in `src/modules/index.ts`.

Options:

```bash
kick g module order --repo drizzle    # Drizzle repository implementation
kick g module order --no-entity       # Skip entity and value object generation
kick g module order --minimal         # Minimal scaffold
```

## Module Composition

Modules are composed in the entry point via the `modules` array:

```ts
// src/modules/index.ts
import type { AppModuleClass } from '@kickjs/core'
import { TodoModule } from './todos'
import { OrderModule } from './orders'

export const modules: AppModuleClass[] = [TodoModule, OrderModule]
```

```ts
// src/index.ts
import { bootstrap } from '@kickjs/http'
import { modules } from './modules'

bootstrap({ modules, apiPrefix: '/api', defaultVersion: 1 })
```

Each module is self-contained. Routes are mounted at `/{apiPrefix}/v{version}{path}`, so a module with `path: '/todos'` becomes `/api/v1/todos`.
