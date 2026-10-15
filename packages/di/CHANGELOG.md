# @forinda/kickjs-di

## 0.1.0

### Minor Changes

- [#915](https://github.com/forinda/kick-js/pull/915) [`5829fab`](https://github.com/forinda/kick-js/commit/5829fab5af98928d4a60e5bd7c1effc135e0ea54) Thanks [@forinda](https://github.com/forinda)! - The DI container is now its own package, `@forinda/kickjs-di`, and `@forinda/kickjs` is built on it. Nothing changes for apps: `@forinda/kickjs` depends on the exact version and re-exports everything from the same paths, so `Container`, `@Service`, `@Inject`, `@Value`, `createToken` and the `KickJsRegistry` augmentation work as before. Don't install `@forinda/kickjs-di` next to `@forinda/kickjs`. Two copies would each keep their own container, and the package now warns when a second copy loads.
