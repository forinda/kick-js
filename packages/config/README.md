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

- `defineEnv()` — extend the base schema with app-specific env vars
- `loadEnv()` — validates `process.env` against your Zod schema (cached per schema)
- `ConfigService` — injectable service with `get()`, `isProduction()`, `isDevelopment()`
- `@Value('ENV_KEY', default?)` — property decorator for env injection

## Quick Example

```typescript
import { defineEnv, loadEnv } from '@forinda/kickjs-config'
import { z } from 'zod'

const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  }),
)

const env = loadEnv(envSchema)
console.log(env.DATABASE_URL)
```

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
