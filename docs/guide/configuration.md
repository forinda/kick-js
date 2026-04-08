# Configuration

`@forinda/kickjs` ships Zod-validated environment configuration with caching, an injectable typed service, and tight integration with `kick typegen` — every API in this guide is type-safe with no manual schema passing. No extra package install is required.

::: tip Moved from `@forinda/kickjs-config`
Earlier releases shipped these APIs in a separate `@forinda/kickjs-config` package. They now live inside `@forinda/kickjs` itself. The standalone package still exists as a thin re-export shim for one release and will be removed in v3 — migrate your imports to `@forinda/kickjs`.

`.env` file loading uses [`dotenv`](https://github.com/motdotla/dotenv), which is now an **optional peer dependency**. New projects scaffolded with `kick new` get it pre-installed; existing projects should add it explicitly if they rely on `.env` files (`pnpm add dotenv`). Apps that load env via the shell, Docker, or a secret manager can skip it entirely.
:::

## Defining an Environment Schema

The recommended pattern: put your schema in **`src/env.ts`** as a default export. `kick init` scaffolds this file for you, and `kick typegen` (auto-run on `kick dev`) reads it once and populates the global `KickEnv` interface — that's what makes `ConfigService.get`, `loadEnv`, `getEnv`, `process.env`, and `@Value` all type-safe across the project.

Use `defineEnv()` to extend the base schema with your application-specific variables. The base schema includes `PORT`, `NODE_ENV`, and `LOG_LEVEL`:

```ts
// src/env.ts
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

### resetEnvCache

Clear the cached config. Useful in tests when you need to reload with different environment values:

```ts
import { resetEnvCache, loadEnv } from '@forinda/kickjs'

resetEnvCache()
process.env.PORT = '4000'
const env = loadEnv(envSchema) // re-parsed with new PORT
```

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
