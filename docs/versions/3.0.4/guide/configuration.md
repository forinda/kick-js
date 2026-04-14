# Configuration

`@forinda/kickjs` ships Zod-validated environment configuration with caching, an injectable typed service, and tight integration with `kick typegen` — every API in this guide is type-safe with no manual schema passing. No extra package install is required.

::: tip Moved from `@forinda/kickjs-config`
Earlier releases shipped these APIs in a separate `@forinda/kickjs-config` package. They now live inside `@forinda/kickjs` itself. The standalone package still exists as a thin re-export shim for one release and will be removed in v3 — migrate your imports to `@forinda/kickjs`.

`.env` file loading uses [`dotenv`](https://github.com/motdotla/dotenv), which is now an **optional peer dependency**. New projects scaffolded with `kick new` get it pre-installed; existing projects should add it explicitly if they rely on `.env` files (`pnpm add dotenv`). Apps that load env via the shell, Docker, or a secret manager can skip it entirely.
:::

## Defining an Environment Schema

The recommended pattern: put your schema in **`src/config/index.ts`** as a default export (older scaffolds put it at `src/env.ts` — both still work; the typegen scanner searches both). `kick new` creates this file for you, and `kick typegen` (auto-run on `kick dev`) reads it once and populates the global `KickEnv` interface — that's what makes `ConfigService.get`, `loadEnv`, `getEnv`, `process.env`, and `@Value` all type-safe across the project.

Use `defineEnv()` to extend the base schema with your application-specific variables. The base schema includes `PORT`, `NODE_ENV`, and `LOG_LEVEL`:

```ts
// src/config/index.ts
import { defineEnv } from '@forinda/kickjs'
import { z } from 'zod'

export default defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    REDIS_URL: z.string().url().optional(),
  }),
)
```

Once this file exists, run `kick typegen` once (or just start `kick dev`) and the schema flows through to every consumer automatically. See [Type Generation](typegen.md#how-env-vars-are-typed) for the full pipeline.

## Wiring the schema at startup

::: danger Required: side-effect import
The schema in `src/env.ts` is a **declaration only**. You must also call `loadEnv(envSchema)` (the canonical pattern below does this for you) **and** make sure that file is imported as a side effect from `src/index.ts` *before* `bootstrap()` runs. If you skip this:

- `ConfigService.get('YOUR_KEY')` returns `undefined` for every user-defined key.
- `loadEnv()` (no-arg) falls back to `baseEnvSchema` and only knows `PORT`, `NODE_ENV`, `LOG_LEVEL`.
- `@Value('YOUR_KEY')` *appears* to keep working — but only because it has a raw `process.env` fallback baked in. The Zod-validated typed value is not available, the schema's defaults never apply, and `z.coerce.number()` etc. silently drop their type coercion. This is the divergence that causes "ConfigService doesn't see my env" bug reports.

`kick new` scaffolds both halves of the wiring for you. If you're upgrading an older project by hand, follow the canonical pattern below.
:::

The canonical `src/config/index.ts` calls `loadEnv(envSchema)` itself so the file does double duty as both a schema declaration *and* a runtime registration:

```ts
// src/config/index.ts
import { defineEnv, loadEnv } from '@forinda/kickjs/config'
import { z } from 'zod'

const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  }),
)

// Side-effect: register the extended schema with kickjs's env cache
// **at module-load time**. ConfigService and @Value() both consume
// this cache.
export const env = loadEnv(envSchema)

export default envSchema
```

And `src/index.ts` pulls it in **before** `bootstrap()`:

```ts
// src/index.ts
import 'reflect-metadata'
// Side-effect import — must come BEFORE any kickjs imports that pull
// in @Service / @Controller / @Value, so the env cache is populated
// when DI starts wiring instances.
import './config'

import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

export const app = await bootstrap({ modules })
```

To pick up `.env` file changes during dev without restarting the server, add `envWatchPlugin()` to `vite.config.ts` (the `kick new` scaffold does this for you):

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  plugins: [
    swc.vite(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    envWatchPlugin(),
  ],
})
```

### Why this matters

`ConfigService` reads through `loadEnv()` lazily on every `get` call — so once `loadEnv(extendedSchema)` has been called *anywhere* in the app, every `ConfigService` instance (whether resolved before or after) sees the extended values. The catch is "anywhere": if `src/env.ts` is never imported, `loadEnv(extendedSchema)` never runs and the cached schema stays empty (or downgrades to the base shape).

`@Value()` masks this bug because it has a defensive `process.env[key]` fallback. `ConfigService` deliberately does **not** — it returns whatever the validated env cache holds, so calls to `config.get('CUSTOM_KEY')` come back `undefined` until the schema has been registered. Treat `ConfigService.get` returning `undefined` for a known-good `.env` value as a strong signal that `src/env.ts` is not being imported at startup.

The base schema provides these defaults:

| Variable    | Type                                      | Default         |
| ----------- | ----------------------------------------- | --------------- |
| `PORT`      | `number`                                  | `3000`          |
| `NODE_ENV`  | `'development' \| 'production' \| 'test'` | `'development'` |
| `LOG_LEVEL` | `string`                                  | `'info'`        |

## Loading and Accessing Environment Variables

### loadEnv

Parse and validate `process.env` against your schema. The result is cached — subsequent calls return the same object without re-parsing:

```ts
import { loadEnv } from '@forinda/kickjs'

// No-arg form — returns KickEnv when typegen has populated it,
// otherwise returns the base Env shape.
const env = loadEnv()
env.DATABASE_URL // string (typed from src/env.ts)
env.PORT // number

// Explicit-schema form — useful for tests or one-off scripts that
// need a different schema than the project default.
const testEnv = loadEnv(testSchema)
```

The cache is **sticky**: once you've called `loadEnv(extendedSchema)` once, subsequent `loadEnv()` calls reuse the extended schema instead of falling back to the base. This matters because `ConfigService` (and the bare `@Value` resolver) call `loadEnv()` no-arg internally — without stickiness, instantiating them after a custom schema load would silently downgrade the env.

### getEnv

Retrieve a single variable. With typegen active, the key is constrained to known `KickEnv` keys and the return type is inferred:

```ts
import { getEnv } from '@forinda/kickjs'

const port = getEnv('PORT') // number (Zod-coerced)
const url = getEnv('DATABASE_URL') // string
// const bad = getEnv('NOPE')      // ❌ tsc error
```

You can still pass an explicit schema as the second argument when you need a one-off shape outside the project default.

### reloadEnv vs resetEnvCache

`reloadEnv()` and `resetEnvCache()` look similar but answer different questions, and using the wrong one in dev produces a subtle "user keys disappear" bug. Pick the right tool:

| Function | Clears parsed values? | Clears registered schema? | Use when |
| --- | --- | --- | --- |
| `reloadEnv()` | yes | **no** | a `.env` file changed; you want fresh values against the *same* schema. Called automatically by `envWatchPlugin()` and the kickjs HMR rebuild path. |
| `resetEnvCache()` | yes | yes | a test wants a totally fresh slate, e.g. swapping `envSchema` between cases. |

`reloadEnv()` deliberately keeps the registered schema so the next read re-parses `process.env` against your extended shape instead of falling back to the base schema. If it dropped the schema instead, every `ConfigService.get('CUSTOM_KEY')` after a `.env` save would silently start returning `undefined` — which is exactly the bug HMR users would hit on every reload before this fix.

If you need to swap schemas between cases (typically only in tests), call `resetEnvCache()` then `loadEnv(newSchema)`:

```ts
import { resetEnvCache, loadEnv } from '@forinda/kickjs'

resetEnvCache()
process.env.PORT = '4000'
const env = loadEnv(envSchema) // re-parsed with new PORT against fresh schema
```

For the normal "edit `.env`, want the new value" flow, do nothing — `envWatchPlugin()` calls `reloadEnv()` for you and `ConfigService.get()` immediately returns the new value.

## Accessing Config in Services

`ConfigService` is the recommended way to read env config from a DI-managed class. It's an injectable singleton that consumes the `KickEnv` global populated by `kick typegen`, so as long as your `src/env.ts` is in place you get full type safety with **zero extra setup** — no schema to pass around, no separate typed-service factory, no manual casts.

```ts
import { Service, Autowired, ConfigService } from '@forinda/kickjs'

@Service()
class DatabaseService {
  @Autowired() private readonly config!: ConfigService

  connect() {
    const url = this.config.get('DATABASE_URL') // string — autocompletes from src/env.ts
    const port = this.config.get('PORT') // number — Zod-coerced from baseEnvSchema
    // const bad = this.config.get('NOPE')  // ❌ tsc error: '"NOPE"' is not assignable to 'never'
  }
}
```

`config.getAll()` returns `Readonly<KickEnv>` — every known key is typed and you get autocomplete on the entire config object.

### How it knows the schema

Once `kick typegen` has run against `src/env.ts`, the generated `.kickjs/types/env.ts` augments a global `KickEnv` interface with your schema's inferred shape. `ConfigService.get` (and `loadEnv`, `getEnv`, the `@Value` decorator, and `process.env`) all consume that single source of truth — see [Type Generation](typegen.md#how-env-vars-are-typed) for the details.

### Without typegen (legacy projects)

If `KickEnv` is empty (no `src/env.ts`, or you've disabled env typegen), `ConfigService.get` falls back to its previous untyped signature so existing call sites keep compiling:

```ts
const url = this.config.get<string, string>('DATABASE_URL') // explicit T generic
```

The two-generic form `get<K, T>` lets you supply a return type when typegen isn't available. With typegen active, the explicit `T` is ignored and the schema-inferred type wins.

### `loadEnv` and `getEnv` outside DI

For module-scope access (utilities, startup code, scripts), use `loadEnv()` and `getEnv()` directly. Both consume `KickEnv` when available:

```ts
import { loadEnv, getEnv } from '@forinda/kickjs'

// loadEnv() with no arg returns KickEnv when typegen has run
const env = loadEnv()
env.DATABASE_URL // string
env.PORT // number

// getEnv() also takes the no-arg form and returns the inferred type
const port = getEnv('PORT') // number
const secret = getEnv('JWT_SECRET') // string
```

You can still pass an explicit schema to either function — useful for one-off scripts or tests that need a different schema than the project default. The cache is **sticky**: once `loadEnv(extendedSchema)` has been called, subsequent `loadEnv()` calls reuse the extended schema instead of falling back to the base.

### `createConfigService` (deprecated)

Earlier versions required `createConfigService(envSchema)` to get a typed service. That escape hatch still works for back-compat, but it's no longer the recommended path — typed `ConfigService` covers every use case with less boilerplate. Migrate by:

1. Putting your schema in `src/env.ts` (default-exported via `defineEnv`)
2. Running `kick typegen` once (or just `kick dev` — it auto-runs)
3. Replacing `createConfigService(envSchema)` with the bare `ConfigService` import and dropping the schema argument from your DI wiring

### Available Methods

| Method            | Return                                | Description                              |
| ----------------- | ------------------------------------- | ---------------------------------------- |
| `get(key)`        | `KickEnv[K]` (or `T` for back-compat) | Get a single env variable by key         |
| `getAll()`        | `Readonly<KickEnv>`                   | Get a frozen copy of all config values   |
| `reload()`        | `void`                                | Re-read `.env` and re-validate (for HMR) |
| `isProduction()`  | `boolean`                             | `NODE_ENV === 'production'`              |
| `isDevelopment()` | `boolean`                             | `NODE_ENV === 'development'`             |
| `isTest()`        | `boolean`                             | `NODE_ENV === 'test'`                    |

## @Value Decorator

The `@Value` decorator injects an environment variable directly into a class property. It is evaluated lazily -- the value is read from `process.env` at access time, not at decoration time.

```ts
import { Service, Value, type Env } from '@forinda/kickjs'

@Service()
class MailService {
  @Value('SMTP_HOST', 'localhost')
  private smtpHost!: Env<'SMTP_HOST'>

  @Value('SMTP_PORT', '587')
  private smtpPort!: Env<'SMTP_PORT'>

  @Value('SMTP_API_KEY')
  private apiKey!: Env<'SMTP_API_KEY'> // throws if SMTP_API_KEY is not set
}
```

When `kick typegen` has populated the `KickEnv` global from your `src/env.ts`, `@Value` is constrained to known keys (`@Value('NOPE')` becomes a tsc error) and `Env<K>` resolves to the schema's inferred type for that key — so `Env<'PORT'>` is `number` rather than `string`. See [Type Generation](typegen.md#how-env-vars-are-typed) for the full pipeline.

For projects that don't use the env schema, raw string keys still work — `@Value` falls back to accepting any string when `KickEnv` is empty.

If no default is provided and the environment variable is missing, accessing the property throws an error to catch misconfiguration early:

```
@Value('SMTP_API_KEY'): Environment variable "SMTP_API_KEY" is not set and no default was provided.
```

The container wires up `@Value` properties through `Object.defineProperty` getters during instance creation, alongside `@Autowired` property injection.
