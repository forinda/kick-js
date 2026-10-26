# @forinda/kickjs-di

## 0.3.1

### Patch Changes

- [#1087](https://github.com/forinda/kick-js/pull/1087) [`ffc912a`](https://github.com/forinda/kick-js/commit/ffc912a0c7e73f9c71eb2a426b7252031c848ebe) Thanks [@forinda](https://github.com/forinda)! - `container.resolve()` infers the type of abstract classes and classes with a private or protected constructor, which used to come back as `any`. A value that isn't a token, such as the Promise from an `import()` you forgot to `await`, is now a compile error instead of an untyped `any` that throws at runtime. Strings and symbols typegen doesn't know, and `any`-typed tokens, still return `any`, and an explicit type still overrides a token's: `resolve<Wider>(TOKEN)`.

## 0.3.0

### Minor Changes

- [#980](https://github.com/forinda/kick-js/pull/980) [`f58ce9e`](https://github.com/forinda/kick-js/commit/f58ce9ebf464b6867129bde31d816da0eba6f3a1) Thanks [@forinda](https://github.com/forinda)! - `container.createChild()` returns a container that resolves its own bindings first and falls back to its parent: overrides for one tenant, job or test without touching the parent.
  
  - **Lookup:** `has()` looks through to the parent; the new `hasOwn()` doesn't. Lookup order is the child's binding, the parent's, the child's fallback, then the parent's.
  - **REQUEST scope:** a child's REQUEST-scoped instances are kept apart from the parent's in the same request.
  - **HMR:** an invalidation in the parent rebuilds what the child built on it.
  - **Lifetime:** `dispose()` detaches a child. Children are held weakly, so one that is never disposed is still garbage-collected.

- [#979](https://github.com/forinda/kick-js/pull/979) [`c258a19`](https://github.com/forinda/kick-js/commit/c258a19151b8e69f00feb796c130a88c0171e36b) Thanks [@forinda](https://github.com/forinda)! - The container's hooks are methods now, not `_`-prefixed static fields. `Container.setLogger()`, `setErrorFactory()`, `setEnvResolver()` and `setRequestStoreProvider()` set them, and `null` restores the default; `Container.logger`, `errorFactory`, `envResolver` and `requestStoreProvider` read them back. `Container.definePropertyInjector(key, prepare)` replaces `Container._propertyInjectors.set(...)`, and `registerInjectable()` replaces `_registerInjectable()`. The decorator lifecycle hooks (`_onReady`, `_onReset`, `_onCreate`) are internal and no longer part of the published types.
  
  The new types `RequestStore`, `RequestStoreProvider`, `EnvResolver`, `ErrorFactory` and `PropertyInjector` are exported. Doc comments no longer describe KickJS internals; where KickJS fills something in for you (`kick typegen` writing `KickJsRegistry` and `Env`), they say so.
  
  Migrating: `Container._logger = x` becomes `Container.setLogger(x)`, and likewise for the other hooks.
  
  `ctn` is a short alias of `createToken`, exported from both packages: `const MAILER = ctn<Mailer>('app/mailer')`. kick-lint's token-naming rules check `ctn(...)` calls too.

## 0.2.0

### Minor Changes

- [#933](https://github.com/forinda/kick-js/pull/933) [`12363f8`](https://github.com/forinda/kick-js/commit/12363f86c9e58a6016266db0793b52beab1b8030) Thanks [@forinda](https://github.com/forinda)! - `container.registerFallback(token, factory, scope?)` — a default binding used only while nothing else binds the token, whatever the registration order. An adapter can register one in `beforeMount` (before modules register) and a module's `register()` binding still wins. `has(token)` stays `false` for a fallback-only token, and `getRegistrations()` marks a token its fallback serves with `fallback: true`; DevTools shows a _fallback_ badge on it. Binding the token normally after its singleton fallback was resolved throws the new `KICK010`, since code already holding the fallback would disagree with the new binding.

## 0.1.0

### Minor Changes

- [#915](https://github.com/forinda/kick-js/pull/915) [`5829fab`](https://github.com/forinda/kick-js/commit/5829fab5af98928d4a60e5bd7c1effc135e0ea54) Thanks [@forinda](https://github.com/forinda)! - The DI container is now its own package, `@forinda/kickjs-di`, and `@forinda/kickjs` is built on it. Nothing changes for apps: `@forinda/kickjs` depends on the exact version and re-exports everything from the same paths, so `Container`, `@Service`, `@Inject`, `@Value`, `createToken` and the `KickJsRegistry` augmentation work as before. Don't install `@forinda/kickjs-di` next to `@forinda/kickjs`. Two copies would each keep their own container, and the package now warns when a second copy loads.
