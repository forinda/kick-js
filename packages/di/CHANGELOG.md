# @forinda/kickjs-di

## 0.2.0

### Minor Changes

- [#933](https://github.com/forinda/kick-js/pull/933) [`12363f8`](https://github.com/forinda/kick-js/commit/12363f86c9e58a6016266db0793b52beab1b8030) Thanks [@forinda](https://github.com/forinda)! - `container.registerFallback(token, factory, scope?)` — a default binding used only while nothing else binds the token, whatever the registration order. An adapter can register one in `beforeMount` (before modules register) and a module's `register()` binding still wins. `has(token)` stays `false` for a fallback-only token, and `getRegistrations()` marks a token its fallback serves with `fallback: true`; DevTools shows a _fallback_ badge on it. Binding the token normally after its singleton fallback was resolved throws the new `KICK010`, since code already holding the fallback would disagree with the new binding.

## 0.1.0

### Minor Changes

- [#915](https://github.com/forinda/kick-js/pull/915) [`5829fab`](https://github.com/forinda/kick-js/commit/5829fab5af98928d4a60e5bd7c1effc135e0ea54) Thanks [@forinda](https://github.com/forinda)! - The DI container is now its own package, `@forinda/kickjs-di`, and `@forinda/kickjs` is built on it. Nothing changes for apps: `@forinda/kickjs` depends on the exact version and re-exports everything from the same paths, so `Container`, `@Service`, `@Inject`, `@Value`, `createToken` and the `KickJsRegistry` augmentation work as before. Don't install `@forinda/kickjs-di` next to `@forinda/kickjs`. Two copies would each keep their own container, and the package now warns when a second copy loads.
