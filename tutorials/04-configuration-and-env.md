---
title: Configuration & Env
subtitle: Typed env that hot-reloads
number: '04'
tag: Core
accent: '#10b981'
---

# Configuration & Env

KickJS validates your environment at boot against a schema, exposes it **typed** via `ConfigService` / `@Value`, and — in dev — **hot-reloads** when you edit `.env`. No restart.

## Define the schema

```ts
// src/config/index.ts
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    LOG_LEVEL: z.string().default('info'),
  }),
)

// Side effect: registers the schema BEFORE any @Value resolves.
export const env = loadEnvFromSchema(envSchema)
```

Wire it first in `src/index.ts`:

```ts
import './config' // MUST be the first import
```

## Read it, typed

```ts
import { Service, Value, ConfigService, Autowired } from '@forinda/kickjs'

@Service()
class Db {
  // Property-level injection.
  @Value('DATABASE_URL') private readonly url!: string

  // Or the whole service — get() autocompletes known keys.
  @Autowired() private readonly config!: ConfigService

  connect() {
    return open(this.config.get('DATABASE_URL'))
  }
}
```

`kick typegen` reads your schema and makes `config.get('DATABASE_URL')` return a typed `string` — and `config.get('NOPE')` a compile error.

## Hot reload

In dev the Vite `envWatchPlugin` watches `.env`. Edit a value → it calls `reloadEnv()` (dotenv `override: true` + re-parse) → the next `config.get()` returns the new value, no restart.

```ts
// Read config LIVE in handlers — don't snapshot at boot.
app.get('/env', (_req, res) => {
  res.json({ logLevel: config.get('LOG_LEVEL') }) // always current
})
```

> A value captured once at boot is frozen. Live `config.get()` reads stay current after a `.env` edit. Read late, not early.

## Why it matters

- **Fail fast** — a missing `DATABASE_URL` crashes at boot with a clear Zod error, not at 3am on the first request.
- **Typed** — no `process.env.FOO!` with a string-typed `any`.
- **Fast feedback** — change `.env`, see it live.

## Next

[Database (kickjs-db) →](./05-database.md)
