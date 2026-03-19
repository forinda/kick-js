# Configuration

The `@kickjs/config` package provides Zod-validated environment configuration with caching and an injectable service for accessing values throughout your application.

## Defining an Environment Schema

Use `defineEnv()` to extend the base schema with your application-specific variables. The base schema includes `PORT`, `NODE_ENV`, and `LOG_LEVEL`:

```ts
import { z } from 'zod'
import { defineEnv } from '@kickjs/config'

const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    REDIS_URL: z.string().url().optional(),
  })
)
```

The base schema provides these defaults:

| Variable | Type | Default |
| --- | --- | --- |
| `PORT` | `number` | `3000` |
| `NODE_ENV` | `'development' \| 'production' \| 'test'` | `'development'` |
| `LOG_LEVEL` | `string` | `'info'` |

## Loading and Accessing Environment Variables

### loadEnv

Parse and validate `process.env` against your schema. The result is cached -- subsequent calls return the same object without re-parsing:

```ts
import { loadEnv } from '@kickjs/config'

const env = loadEnv(envSchema)
console.log(env.DATABASE_URL) // fully typed
```

If called without a schema, `loadEnv()` uses the base schema only.

### getEnv

Retrieve a single variable from the cached config:

```ts
import { getEnv } from '@kickjs/config'

const port = getEnv('PORT') // uses cached env, falls back to base schema
```

### resetEnvCache

Clear the cached config. Useful in tests when you need to reload with different environment values:

```ts
import { resetEnvCache, loadEnv } from '@kickjs/config'

resetEnvCache()
process.env.PORT = '4000'
const env = loadEnv(envSchema) // re-parsed with new PORT
```

## ConfigService

`ConfigService` is an injectable singleton that wraps `loadEnv()`. Inject it into any service or controller:

```ts
import { Service, Autowired } from '@kickjs/core'
import { ConfigService } from '@kickjs/config'

@Service()
class DatabaseService {
  @Autowired()
  private config!: ConfigService

  connect() {
    const url = this.config.get<string>('DATABASE_URL')
    // ...
  }
}
```

### Available Methods

| Method | Return | Description |
| --- | --- | --- |
| `get<T>(key)` | `T` | Get a single env variable by key |
| `getAll()` | `Readonly<Record>` | Get a frozen copy of all config values |
| `isProduction()` | `boolean` | `NODE_ENV === 'production'` |
| `isDevelopment()` | `boolean` | `NODE_ENV === 'development'` |
| `isTest()` | `boolean` | `NODE_ENV === 'test'` |

## @Value Decorator

The `@Value` decorator injects an environment variable directly into a class property. It is evaluated lazily -- the value is read from `process.env` at access time, not at decoration time.

```ts
import { Service, Value } from '@kickjs/core'

@Service()
class MailService {
  @Value('SMTP_HOST', 'localhost')
  private smtpHost!: string

  @Value('SMTP_PORT', '587')
  private smtpPort!: string

  @Value('SMTP_API_KEY')
  private apiKey!: string // throws if SMTP_API_KEY is not set
}
```

If no default is provided and the environment variable is missing, accessing the property throws an error to catch misconfiguration early:

```
@Value('SMTP_API_KEY'): Environment variable "SMTP_API_KEY" is not set and no default was provided.
```

The container wires up `@Value` properties through `Object.defineProperty` getters during instance creation, alongside `@Autowired` property injection.
