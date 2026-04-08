# Configuration

The `@forinda/kickjs-config` package provides Zod-validated environment configuration with caching and an injectable service for accessing values throughout your application.

## Defining an Environment Schema

Use `defineEnv()` to extend the base schema with your application-specific variables. The base schema includes `PORT`, `NODE_ENV`, and `LOG_LEVEL`:

```ts
import { z } from 'zod'
import { defineEnv } from '@forinda/kickjs-config'

const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    REDIS_URL: z.string().url().optional(),
  }),
)
```

The base schema provides these defaults:

| Variable    | Type                                      | Default         |
| ----------- | ----------------------------------------- | --------------- |
| `PORT`      | `number`                                  | `3000`          |
| `NODE_ENV`  | `'development' \| 'production' \| 'test'` | `'development'` |
| `LOG_LEVEL` | `string`                                  | `'info'`        |

## Loading and Accessing Environment Variables

### loadEnv

Parse and validate `process.env` against your schema. The result is cached -- subsequent calls return the same object without re-parsing:

```ts
import { loadEnv } from '@forinda/kickjs-config'

const env = loadEnv(envSchema)
console.log(env.DATABASE_URL) // fully typed
```

If called without a schema, `loadEnv()` uses the base schema only.

### getEnv

Retrieve a single variable from the cached config:

```ts
import { getEnv } from '@forinda/kickjs-config'

const port = getEnv('PORT') // uses cached env, falls back to base schema
```

### resetEnvCache

Clear the cached config. Useful in tests when you need to reload with different environment values:

```ts
import { resetEnvCache, loadEnv } from '@forinda/kickjs-config'

resetEnvCache()
process.env.PORT = '4000'
const env = loadEnv(envSchema) // re-parsed with new PORT
```

## Accessing Config in Services

There are two approaches for accessing environment config via DI. Choose based on whether you need full type safety.

### Option 1: `ConfigService` (untyped, quick)

`ConfigService` is a built-in injectable singleton that wraps `loadEnv()` with the base schema. It works without any setup but does **not** provide typed keys or return values — you must cast manually:

```ts
import { Service, Autowired } from '@forinda/kickjs'
import { ConfigService } from '@forinda/kickjs-config'

@Service()
class DatabaseService {
  @Autowired() private config!: ConfigService

  connect() {
    const url = this.config.get<string>('DATABASE_URL') // manual cast, no autocomplete
  }
}
```

### Option 2: `createConfigService` (fully typed, recommended)

`createConfigService()` creates an injectable service class bound to your Zod schema. Keys autocomplete and return values are inferred from the schema — no manual casting:

```ts
// src/config/env.ts
import { z } from 'zod'
import { defineEnv, loadEnv, createConfigService } from '@forinda/kickjs-config'

export const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    REDIS_URL: z.string().url().optional(),
  }),
)

// Direct access (no DI needed)
export const env = loadEnv(envSchema)
env.DATABASE_URL // string — fully typed
env.JWT_SECRET // string — fully typed
env.REDIS_URL // string | undefined — fully typed

// Injectable service (for DI)
export const AppConfigService = createConfigService(envSchema)
export type AppConfigService = InstanceType<typeof AppConfigService>
```

Then inject it in any service or controller:

```ts
import { Service, Autowired } from '@forinda/kickjs'
import { AppConfigService } from '../config/env'

@Service()
class DatabaseService {
  @Autowired() private config!: AppConfigService

  connect() {
    const url = this.config.get('DATABASE_URL') // string — autocompletes!
    const bad = this.config.get('NOPE') // TS error — key doesn't exist
  }
}
```

### Which to use?

|                      | `loadEnv()`         | `ConfigService`    | `createConfigService()` |
| -------------------- | ------------------- | ------------------ | ----------------------- |
| **Type safety**      | Full                | None (manual cast) | Full                    |
| **DI injectable**    | No                  | Yes                | Yes                     |
| **Key autocomplete** | Yes                 | No                 | Yes                     |
| **Best for**         | Module-scope access | Quick prototyping  | Production services     |

### Available Methods

Both `ConfigService` and `createConfigService` instances provide:

| Method            | Return           | Description                              |
| ----------------- | ---------------- | ---------------------------------------- |
| `get(key)`        | typed value      | Get a single env variable by key         |
| `getAll()`        | `Readonly<TEnv>` | Get a frozen copy of all config values   |
| `reload()`        | `void`           | Re-read `.env` and re-validate (for HMR) |
| `isProduction()`  | `boolean`        | `NODE_ENV === 'production'`              |
| `isDevelopment()` | `boolean`        | `NODE_ENV === 'development'`             |
| `isTest()`        | `boolean`        | `NODE_ENV === 'test'`                    |

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
