# kick tinker

Interactive REPL with the full DI container loaded. Inspect services, run queries, test logic — without writing scripts or hitting endpoints.

## Usage

```bash
kick tinker                        # loads src/index.ts
kick tinker --entry src/app.ts     # custom entry point
```

Requires `tsx` as a dev dependency:
```bash
pnpm add -D tsx
```

## Available Globals

| Global | Description |
|---|---|
| `container` | DI container instance with all registered services |
| `resolve(T)` | Shorthand for `container.resolve(T)` |
| `Container` | Container class (for `.reset()`, `.has()`, etc.) |
| `Logger` | Logger class |
| `HttpException` | HTTP exception factory |
| `HttpStatus` | HTTP status code constants |

## Resolving Services

Import your classes and resolve them from the container:

```
kick> const { UserService } = await import('./src/modules/users/domain/services/user-domain.service.ts')
kick> const userService = resolve(UserService)
kick> await userService.ensureExists('some-id')
```

Or use DI tokens directly:

```
kick> const { USER_REPOSITORY } = await import('./src/modules/users/domain/repositories/user.repository.ts')
kick> const repo = container.resolve(USER_REPOSITORY)
kick> await repo.findAll()
```

## Inspecting the Container

```
kick> container.getRegistrations()    // List all registered tokens
kick> container.has(UserService)      // Check if a class is registered
```

## Running Business Logic

```
kick> const { CreateUserUseCase } = await import('./src/modules/users/application/use-cases/create-user.use-case.ts')
kick> const useCase = resolve(CreateUserUseCase)
kick> await useCase.execute({ name: 'Alice', email: 'alice@test.com' })
```

## Using Logger

```
kick> const log = Logger.for('Tinker')
kick> log.info('Testing from REPL')
```

## How It Works

1. `kick tinker` spawns a Node process under `tsx` (for TypeScript + decorator support)
2. Sets `KICK_TINKER=1` so `bootstrap()` registers modules without starting the HTTP server
3. Imports your entry file to trigger all `@Service()`, `@Controller()`, etc. decorators
4. Opens a Node REPL with the populated container injected as globals

## Exiting

- Type `.exit`
- Press `Ctrl+C` twice
- Press `Ctrl+D`
