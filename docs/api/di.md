# @forinda/kickjs-di

The dependency injection container KickJS is built on: typed tokens, class decorators, singleton / transient / request scopes, and registrations that survive HMR. It has no HTTP code and no Node-only imports.

**In a KickJS app you already have it.** `@forinda/kickjs` depends on the exact version and re-exports all of it, so import from `@forinda/kickjs` as the [DI guide](../guide/dependency-injection.md) shows. Don't add `@forinda/kickjs-di` next to it: two installed copies each keep their own container (see [One copy only](#one-copy-only)).

This page is for using the container **without** the framework: a CLI, a worker, a script, another HTTP server.

## Install

```bash
pnpm add @forinda/kickjs-di reflect-metadata
```

It uses legacy decorators with emitted metadata, like the rest of KickJS:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Import `reflect-metadata` once, before any decorated class loads.

## Example

```ts
import 'reflect-metadata'
import { Container, Service, Inject, createToken } from '@forinda/kickjs-di'

const GREETING = createToken<string>('greeting')

@Service()
class Greeter {
  constructor(@Inject(GREETING) private readonly greeting: string) {}
  hi(name: string) {
    return `${this.greeting}, ${name}`
  }
}

const container = Container.getInstance()
container.registerInstance(GREETING, 'Hello')
container.resolve(Greeter).hi('Ada') // 'Hello, Ada'
```

A class constructor parameter is injected by its type; a token or an interface needs `@Inject(token)`. Everything in the [DI guide](../guide/dependency-injection.md) about decorators, tokens, factories, `@Autowired`, `@Value`, `@PostConstruct` and scopes applies unchanged. The rest of this page covers what differs without the framework.

## Exports

| Group             | Exports                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Container         | `Container`, `tokenName`, `ContainerChangeEvent`, `ContainerChangeListener`, `KickJsRegistry`                           |
| Class decorators  | `Injectable`, `Service`, `Component`, `Repository`, `Builder`, `withBuilder`                                            |
| Member decorators | `Inject`, `Autowired`, `Value`, `PostConstruct`, `PreDestroy`                                                           |
| Tokens            | `createToken`, `isInjectionToken`, `INJECTION_TOKEN`, `InjectionToken`                                                  |
| Types             | `Scope`, `Constructor`, `ServiceOptions`, `BuilderOf`, `Buildable`, `ClassKind`, `PostConstructStatus`, `EnvKey`, `Env` |
| Errors            | `DiError`, `diError`, `DiErrorCode`, `DiLogger`, `defaultLogger`                                                        |
| Metadata helpers  | `DI_METADATA`, `setClassMeta`, `getClassMeta`, `setInMetaMap`, `getMetaMap`, …                                          |
| Disposables       | `registerDisposable`, `drainDisposables`, `runDisposables`, `disposeAll`                                                |

`@Controller`, the route decorators and `@Asset` are HTTP and asset features; they stay in `@forinda/kickjs`.

## Containers

- `Container.getInstance()` — the process-wide container. Decorated classes register on it as they load.
- `Container.create()` — a separate container, seeded with every decorated class so far. Use one per test.
- `Container.reset()` — replace the global container with a fresh one (HMR does this); decorated classes are registered again.

`register(token, Class, scope?)`, `registerFactory(token, () => value, scope?)` and `registerInstance(token, value)` bind tokens by hand; `resolve(token)` and `has(token)` read them.

## Errors

Without the framework the container throws `DiError`, with a stable `code` and the token name (or env key) as `subject`:

| Code      | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| `KICK001` | Nothing is registered for the token.                        |
| `KICK002` | A `Scope.REQUEST` token, but no request store is installed. |
| `KICK003` | A `Scope.REQUEST` token, resolved outside a request.        |
| `KICK004` | `@Value(key)` with the key unset and no default.            |

```ts
import { DiError } from '@forinda/kickjs-di'

try {
  container.resolve('Missing')
} catch (err) {
  if (err instanceof DiError && err.code === 'KICK001') {
    // …
  }
}
```

Inside KickJS the same codes become the catalogued `KickError`s, with the cause and the fix (see [Error handling](../guide/error-handling.md)).

## Hooks

The framework plugs into the container through static hooks. Standalone, set the ones you need once at startup.

| Hook                              | Default                                     | What it does                                                                                                              |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Container._envResolver`          | `null`                                      | `(key) => value` for `@Value`. Without one, `@Value` reads `process.env`, then the default.                               |
| `Container._requestStoreProvider` | `null`                                      | Returns the current request's store for `Scope.REQUEST`. See below.                                                       |
| `Container._error`                | `diError`                                   | `(code, subject) => Error` — build your own errors from the codes.                                                        |
| `Container._logger`               | errors to `console.error`, warnings dropped | `{ warn, error }` — told when an async `@PostConstruct` isn't awaited, or one throws.                                     |
| `Container._propertyInjectors`    | empty                                       | A `Map` from metadata key to `(config, prop) => getter`: your own lazy property decorators, the way KickJS adds `@Asset`. |

```ts
Container._logger = {
  warn: (message) => console.warn(message),
  error: (err, message) => console.error(message, err),
}
```

### Request scope without the framework

`Scope.REQUEST` caches one instance per unit of work. KickJS opens that unit around each HTTP request; standalone, you open it, usually with `AsyncLocalStorage`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { Container, Scope, Service } from '@forinda/kickjs-di'

type Store = { instances: Map<unknown, unknown>; values: Map<unknown, unknown> }
const scope = new AsyncLocalStorage<Store>()
Container._requestStoreProvider = () => scope.getStore() ?? null

@Service({ scope: Scope.REQUEST })
class JobContext {
  readonly startedAt = Date.now()
}

function runJob(work: () => Promise<void>) {
  return scope.run({ instances: new Map(), values: new Map() }, work)
}
```

Inside `runJob`, every `resolve(JobContext)` returns the same instance; each run gets a new one. `values` holds per-unit values you set yourself, such as the current user. For a token registered with `Scope.REQUEST`, `resolve(TOKEN)` returns `store.values.get(TOKEN)` first when it is there.

`@PreDestroy` is not run by this package: KickJS calls it when a request ends. Standalone, release per-unit resources at the end of `runJob` yourself.

## Typed `resolve`

Augment `KickJsRegistry` and `resolve('Name')` returns the registered type:

```ts
declare module '@forinda/kickjs-di' {
  interface KickJsRegistry {
    UserService: UserService
  }
}

const users = container.resolve('UserService') // UserService
```

In a KickJS app, augment `'@forinda/kickjs'` instead (`kick typegen` writes it for you). It is the same interface, re-exported.

## One copy only

Each installed copy of this package has its own global container and its own record of decorated classes, so a class decorated against one copy is missing from the other, with no error. The package warns when a second copy loads:

```
@forinda/kickjs-di is loaded twice:
```

If you see it, make sure only one version is installed (`pnpm why @forinda/kickjs-di`). In a KickJS app, remove any direct dependency on `@forinda/kickjs-di` and let `@forinda/kickjs` bring it.
