---
'@forinda/kickjs-di': minor
'@forinda/kickjs': patch
---

The DI container is now its own package, `@forinda/kickjs-di`, and `@forinda/kickjs` is built on it. Nothing changes for apps: `@forinda/kickjs` depends on the exact version and re-exports everything from the same paths, so `Container`, `@Service`, `@Inject`, `@Value`, `createToken` and the `KickJsRegistry` augmentation work as before. Don't install `@forinda/kickjs-di` next to `@forinda/kickjs`. Two copies would each keep their own container, and the package now warns when a second copy loads.
