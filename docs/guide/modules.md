# Modules

Every feature in a KickJS application is organized as a module. Modules implement the `AppModule` interface from `@forinda/kickjs` and are responsible for registering DI bindings and declaring routes.

## The AppModule Interface

```ts
import type { Container } from '@forinda/kickjs'

interface AppModule {
  register(container: Container): void
  routes(): ModuleRoutes | ModuleRoutes[]
}
```

- **register()** -- bind interfaces to implementations in the DI container.
- **routes()** -- return one or more route definitions to be mounted by the application.

## Basic Module

```ts
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { TODO_REPOSITORY } from './domain/repositories/todo.repository'
import { InMemoryTodoRepository } from './infrastructure/repositories/in-memory-todo.repository'
import { TodoController } from './presentation/todo.controller'

// Eagerly load decorated classes so @Service() decorators fire
import './domain/services/todo-domain.service'
import './application/use-cases/create-todo.use-case'
import './application/use-cases/list-todos.use-case'

export class TodoModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TODO_REPOSITORY, () =>
      container.resolve(InMemoryTodoRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/todos',
      router: buildRoutes(TodoController),
      controller: TodoController,
    }
  }
}
```

## Eager Loading with import.meta.glob

Classes decorated with `@Service()`, `@Repository()`, or `@Component()` must be imported so their decorators execute and register them in the DI container. The generated modules use `import.meta.glob` for this:

```ts
import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)
```

You can also use plain side-effect imports as shown in the basic example above.

## ModuleRoutes Type

```ts
interface ModuleRoutes {
  path: string        // URL prefix, e.g. '/todos'
  router: any         // Express Router from buildRoutes()
  version?: number    // API version override (defaults to Application.defaultVersion)
  controller?: any    // Controller class for OpenAPI introspection
}
```

Routes are mounted at `/{apiPrefix}/v{version}{path}`. With the defaults (`apiPrefix: '/api'`, `defaultVersion: 1`), a module returning `path: '/todos'` mounts at `/api/v1/todos`.

## Multiple Route Sets

A module can expose multiple controllers or versioned endpoints by returning an array:

```ts
routes(): ModuleRoutes[] {
  return [
    {
      path: '/todos',
      router: buildRoutes(TodoController),
      controller: TodoController,
    },
    {
      path: '/todos',
      router: buildRoutes(TodoV2Controller),
      controller: TodoV2Controller,
      version: 2,
    },
  ]
}
```

This mounts both `/api/v1/todos` and `/api/v2/todos`.

## DI Registration Patterns

### Factory binding (interface to implementation)

```ts
register(container: Container): void {
  container.registerFactory(TODO_REPOSITORY, () =>
    container.resolve(InMemoryTodoRepository),
  )
}
```

### Swapping implementations

To switch from in-memory to a database, change the factory target:

```ts
register(container: Container): void {
  container.registerFactory(TODO_REPOSITORY, () =>
    container.resolve(DrizzleTodoRepository),
  )
}
```

No other code changes are needed -- use cases inject via the `TODO_REPOSITORY` symbol token.

## Composing Modules

Modules are collected into an array and passed to `bootstrap()`:

```ts
// src/modules/index.ts
import type { AppModuleClass } from '@forinda/kickjs'
import { TodoModule } from './todos'
import { UserModule } from './users'

export const modules: AppModuleClass[] = [TodoModule, UserModule]
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

bootstrap({ modules })
```

The `bootstrap()` function instantiates each module, calls `register()` to set up DI bindings, bootstraps the container, then mounts all routes.
