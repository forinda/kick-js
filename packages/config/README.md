# @forinda/kickjs-config

Zod-based environment validation and ConfigService for KickJS.

## Install

```bash
# Using the KickJS CLI (recommended)
kick add config

# Manual install
pnpm add @forinda/kickjs-config @forinda/kickjs-core zod
```

## Features

- `defineEnv()` — declare app-specific env vars; the base schema (`PORT`, `NODE_ENV`, `LOG_LEVEL`) is **always merged in automatically**
- `loadEnv()` — validates `process.env` against your Zod schema (cached per schema)
- `ConfigService` — injectable service with `get()`, `isProduction()`, `isDevelopment()`
- `@Value('ENV_KEY', default?)` — property decorator for env injection

## Quick Example

```typescript
import { defineEnv, loadEnv } from '@forinda/kickjs-config'
import { z } from 'zod'

// Style A — return a fresh object; base fields are merged automatically
const envSchema = defineEnv(() =>
  z.object({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  }),
)

// Style B — explicitly extend `base` (still works, identical result)
const envSchemaB = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
  }),
)

const env = loadEnv(envSchema)
env.DATABASE_URL // ✅ string — your key
env.PORT         // ✅ number  — base key, always present
env.NODE_ENV     // ✅ enum    — base key, always present
```

User-defined keys override base keys when they collide, so you can re-type
`PORT` or tighten `NODE_ENV` without losing the rest of the base shape.

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
