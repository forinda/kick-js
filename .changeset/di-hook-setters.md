---
'@forinda/kickjs-di': minor
'@forinda/kickjs': minor
'@forinda/kickjs-lint': patch
---

The container's hooks are methods now, not `_`-prefixed static fields. `Container.setLogger()`, `setErrorFactory()`, `setEnvResolver()` and `setRequestStoreProvider()` set them, and `null` restores the default; `Container.logger`, `errorFactory`, `envResolver` and `requestStoreProvider` read them back. `Container.definePropertyInjector(key, prepare)` replaces `Container._propertyInjectors.set(...)`, and `registerInjectable()` replaces `_registerInjectable()`. The decorator lifecycle hooks (`_onReady`, `_onReset`, `_onCreate`) are internal and no longer part of the published types.

The new types `RequestStore`, `RequestStoreProvider`, `EnvResolver`, `ErrorFactory` and `PropertyInjector` are exported. Doc comments no longer describe KickJS internals; where KickJS fills something in for you (`kick typegen` writing `KickJsRegistry` and `Env`), they say so.

Migrating: `Container._logger = x` becomes `Container.setLogger(x)`, and likewise for the other hooks.

`ctn` is a short alias of `createToken`, exported from both packages: `const MAILER = ctn<Mailer>('app/mailer')`. kick-lint's token-naming rules check `ctn(...)` calls too.
