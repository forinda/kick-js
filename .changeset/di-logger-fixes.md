---
'@forinda/kickjs': patch
---

Fix constructor injection for tsx/ts-node, make Logger injectable, add colored log levels.

- **Constructor injection fallback:** `createInstance` now derives constructor arity from `@Inject` metadata when `design:paramtypes` is absent (tsx, ts-node don't emit it). `@Inject(Token)` on constructor params works without `emitDecoratorMetadata`.
- **Logger is now injectable:** `@Inject(Logger)` resolves to a default Logger singleton auto-registered during bootstrap. Previously Logger had no DI binding and `@Inject(Logger)` threw `No provider for Logger`.
- **Colored log levels:** `ConsoleLoggerProvider` prefixes each line with a colored level tag (`INFO`, `WARN`, `ERROR`, `DEBUG`, `FATAL`). Colors auto-disable when `NO_COLOR` env is set or stdout is not a TTY.
