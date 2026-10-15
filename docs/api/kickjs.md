# @forinda/kickjs

`@forinda/kickjs` is the framework package: the DI container and decorators (re-exported from `@forinda/kickjs-di`), modules, adapters and plugins, the HTTP layer with `RequestContext`, built-in middleware, query parsing, env/config loading, and the pluggable HTTP runtime — Express by default, or Fastify or h3. The root entry exports everything most apps need; the subpaths below exist for narrower imports, optional engines, and the edge build.

## Install

```bash
pnpm add @forinda/kickjs express
```

`express` is the default engine. The other engines and features are optional peers: install `fastify` + `@fastify/middie` for the Fastify runtime, `h3` (v2) for the h3 runtime or the web entry, `multer` for uploads on Express, `croner` for `@Cron`, `zod` for env schemas.

## Entry points

| Import                                      | What it holds                                                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forinda/kickjs`                           | Everything: core (DI, decorators, modules, adapters, plugins, logger, errors), HTTP (`bootstrap`, `Application`, `RequestContext`, middleware, query parsing, `createHandler`), config/env, and `expressRuntime` |
| `@forinda/kickjs/adapter`                   | Adapter types only — `AppAdapter`, `AdapterContext`, `AdapterMiddleware`, `KickServer`                                                                                                                           |
| `@forinda/kickjs/container`                 | `Container`, `tokenName` and container event types                                                                                                                                                               |
| `@forinda/kickjs/decorators`                | `@Controller`, `@Get`/`@Post`/…, `@Middleware`, `@FileUpload`, `@ApiQueryParams`, `@Asset`, plus the DI decorators                                                                                               |
| `@forinda/kickjs/logger`                    | `Logger`, `createLogger`, `ConsoleLoggerProvider`, `LoggerProvider`                                                                                                                                              |
| `@forinda/kickjs/errors`                    | `HttpException`, `HttpStatus`, `ProblemException`, `Problems`, `ProblemDetails`                                                                                                                                  |
| `@forinda/kickjs/reactivity`                | `ref`, `computed`, `watch`, `reactive`, `isRef`, `unref`, `toRefs`                                                                                                                                               |
| `@forinda/kickjs/config`                    | `loadEnv`, `defineEnv`, `baseEnvSchema`, `getEnv`, `reloadEnv`, `withEnv`, `ConfigService`, `createConfigService`                                                                                                |
| `@forinda/kickjs/query`                     | `parseQuery` and the other query-string parsers and types                                                                                                                                                        |
| `@forinda/kickjs/middleware/helmet`         | `helmet()`                                                                                                                                                                                                       |
| `@forinda/kickjs/middleware/cors`           | `cors()`                                                                                                                                                                                                         |
| `@forinda/kickjs/middleware/csrf`           | `csrf()`, `csrfGuard()`                                                                                                                                                                                          |
| `@forinda/kickjs/middleware/rate-limit`     | `rateLimit()`, `RateLimitStore`                                                                                                                                                                                  |
| `@forinda/kickjs/middleware/request-id`     | `requestId()`, `REQUEST_ID_HEADER`                                                                                                                                                                               |
| `@forinda/kickjs/middleware/request-logger` | `requestLogger()`                                                                                                                                                                                                |
| `@forinda/kickjs/middleware/allowed-hosts`  | `allowedHosts()`                                                                                                                                                                                                 |
| `@forinda/kickjs/middleware/breach-padding` | `breachPadding()`                                                                                                                                                                                                |
| `@forinda/kickjs/views`                     | `ViewAdapter` (template engines)                                                                                                                                                                                 |
| `@forinda/kickjs/spa`                       | `SpaAdapter` (serve a built frontend with `index.html` fallback)                                                                                                                                                 |
| `@forinda/kickjs/fastify`                   | `fastifyRuntime()`, `FastifyRuntimeTypes` — needs the `fastify` and `@fastify/middie` peers                                                                                                                      |
| `@forinda/kickjs/h3`                        | `h3Runtime()`, `H3RuntimeTypes` — needs the `h3` v2 peer                                                                                                                                                         |
| `@forinda/kickjs/h3-web`                    | Deprecated alias: `h3WebRuntime` (= `h3Runtime`), kept for one major                                                                                                                                             |
| `@forinda/kickjs/web`                       | Web-standard fetch entry for Cloudflare Workers, Bun and Deno — `createWebApp`, `createFetchHandler`; no Node HTTP imports                                                                                       |

```typescript
import { bootstrap } from '@forinda/kickjs'
import { h3Runtime } from '@forinda/kickjs/h3'
import { modules } from './modules'

await bootstrap({ modules, runtime: h3Runtime() })
```

## Reference

- [Core](./core.md) — `bootstrap()` options, decorators, modules, adapters, plugins, context contributors, route flags, logger, errors
- [HTTP](./http.md) — `Application`, `RequestContext`, runtimes, the web entry, middleware, query parsing
- [Dependency injection](./di.md) — the container and DI decorators (`@forinda/kickjs-di`)
- [Configuration](../guide/configuration.md) — env schemas, `loadEnv`, `ConfigService`, settings
