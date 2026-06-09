---
'@forinda/kickjs': minor
---

Quieter startup by default, plus clearer bootstrap option names.

- **`ConsoleLoggerProvider` now respects `LOG_LEVEL`** (default `info`). Previously every `logger.debug()` printed unconditionally, dumping DI wiring and HMR ticks on each start. Messages below the threshold (`trace < debug < info < warn < error < fatal`, plus `silent`) are now dropped; run with `LOG_LEVEL=debug` to see them. Custom `LoggerProvider` implementations (pino, winston, …) are unaffected — they manage their own levels.

- **The startup route table is now opt-in via `bootstrap({ logRouteTable: true })`** and defaults to **off**. It previously printed automatically in non-production. When enabled it logs at `info` level so it's visible regardless of `LOG_LEVEL`. The old `logRoutesTable` option keeps working as a deprecated alias (`logRouteTable` wins when both are set).

- **`bootstrap({ middlewares: [...] })`** is the new plural option name for the global middleware pipeline. The singular `middleware` is kept as a deprecated alias (`middlewares` wins when both are set), so existing apps keep working.
