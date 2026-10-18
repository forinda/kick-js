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

| Group             | Exports                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container         | `Container`, `tokenName`, `ContainerChangeEvent`, `ContainerChangeListener`, `KickJsRegistry`, `RequestStore`, `RequestStoreProvider`, `EnvResolver`, `ErrorFactory`, `PropertyInjector` |
| Class decorators  | `Injectable`, `Service`, `Component`, `Repository`, `Builder`, `withBuilder`, `registerInjectable` (for your own class decorators)                                                       |
| Member decorators | `Inject`, `Autowired`, `Value`, `PostConstruct`, `PreDestroy`                                                                                                                            |
| Tokens            | `createToken` (short: `ctn`), `isInjectionToken`, `INJECTION_TOKEN`, `InjectionToken`                                                                                                    |
| Types             | `Scope`, `Constructor`, `ServiceOptions`, `BuilderOf`, `Buildable`, `ClassKind`, `PostConstructStatus`, `EnvKey`, `Env`                                                                  |
| Errors            | `DiError`, `diError`, `DiErrorCode`, `DiLogger`, `defaultLogger`                                                                                                                         |
| Metadata helpers  | `DI_METADATA`, `setClassMeta`, `getClassMeta`, `setInMetaMap`, `getMetaMap`, …                                                                                                           |
| Disposables       | `registerDisposable`, `drainDisposables`, `runDisposables`, `disposeAll`                                                                                                                 |

`@Controller`, the route decorators and `@Asset` are HTTP and asset features; they stay in `@forinda/kickjs`.

## Containers

- `Container.getInstance()` — the process-wide container. Decorated classes register on it as they load.
- `Container.create()` — a separate container, seeded with every decorated class so far. Use one per test.
- `Container.reset()` — replace the global container with a fresh one (HMR does this); decorated classes are registered again.

`register(token, Class, scope?)`, `registerFactory(token, () => value, scope?)` and `registerInstance(token, value)` bind tokens by hand; `resolve(token)` and `has(token)` read them.

`registerFallback(token, () => value, scope?)` binds a default that `resolve` uses only while none of the three above binds the token — whichever order they run in. `has(token)` is `false` for a token with only a fallback, and `getRegistrations()` marks a token its fallback serves with `fallback: true`. A later `registerFallback` replaces an earlier one; `Container.reset()` drops them all. Binding the token normally after its SINGLETON fallback was resolved throws `KICK010`. See [Fallback bindings](../guide/dependency-injection.md#fallback-bindings).

## Errors

Without the framework the container throws `DiError`, with a stable `code` and the token name (or env key) as `subject`:

| Code      | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| `KICK001` | Nothing is registered for the token.                        |
| `KICK002` | A `Scope.REQUEST` token, but no request store is installed. |
| `KICK003` | A `Scope.REQUEST` token, resolved outside a request.        |
| `KICK004` | `@Value(key)` with the key unset and no default.            |
| `KICK010` | A token bound after its `registerFallback` was resolved.    |

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

## Configuring the container

Set these once at startup, before anything resolves. Each has a getter to read it back, and passing `null` to the setter restores the default.

| Setter                                        | Getter                           | Default                                     | What it does                                                                                |
| --------------------------------------------- | -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Container.setLogger(logger)`                 | `Container.logger`               | errors to `console.error`, warnings dropped | `{ warn, error }`, told when an async `@PostConstruct` isn't awaited, or one throws.        |
| `Container.setErrorFactory(factory)`          | `Container.errorFactory`         | `diError`                                   | `(code, subject) => Error`: build your own errors from the codes above.                     |
| `Container.setEnvResolver(resolver)`          | `Container.envResolver`          | none                                        | `(key) => value` for `@Value`. Without one, `@Value` reads `process.env`, then the default. |
| `Container.setRequestStoreProvider(provider)` | `Container.requestStoreProvider` | none                                        | Returns the current unit of work's store for `Scope.REQUEST`. See below.                    |

```ts
Container.setLogger({
  warn: (message) => console.warn(message),
  error: (err, message) => console.error(message, err),
})
```

### Your own property decorators

`Container.definePropertyInjector(metadataKey, prepare)` adds a lazy property decorator like `@Value`. For each property a class stores under `metadataKey` (a `Map` on the prototype), `prepare(config, prop)` runs once when the container first builds the class, so it can reject a bad config up front, and returns the getter the property reads through on every instance.

### Your own class decorators

`registerInjectable(target, scope)` registers a class the way `@Service` does, for a class decorator of your own that should also make the class injectable.

### Request scope without the framework

`Scope.REQUEST` caches one instance per unit of work. KickJS opens that unit around each HTTP request; standalone, you open it, usually with `AsyncLocalStorage`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { Container, Scope, Service, type RequestStore } from '@forinda/kickjs-di'

const scope = new AsyncLocalStorage<RequestStore>()
Container.setRequestStoreProvider(() => scope.getStore() ?? null)

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
