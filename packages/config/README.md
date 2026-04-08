# @forinda/kickjs-config — DEPRECATED

> **This package has moved.** Everything that used to live here now ships
> inside the unified `@forinda/kickjs` package. The standalone
> `@forinda/kickjs-config` is a thin re-export shim kept for one release
> so existing apps don't break — **it will be removed in v3**.

## Migration

```diff
- import { defineEnv, loadEnv, ConfigService, getEnv } from '@forinda/kickjs-config'
+ import { defineEnv, loadEnv, ConfigService, getEnv } from '@forinda/kickjs'
```

The Vite-only `envWatchPlugin` moved into the Vite package:

```diff
- import { envWatchPlugin } from '@forinda/kickjs-config'
+ import { envWatchPlugin } from '@forinda/kickjs-vite'
```

`.env` file loading is provided by **`dotenv`**, which is now an
**optional peer dependency** of `@forinda/kickjs`. New projects scaffolded
with `kick new` get it pre-installed; existing projects should add it
explicitly if they rely on `.env` files:

```bash
pnpm add dotenv
```

Apps that load env via the shell, Docker, or a secret manager don't need
`dotenv` at all — `@forinda/kickjs` will read `process.env` directly.

## Why the merge?

- **Smaller install footprint** — one package instead of two for the same
  surface area, with the same dead-code-elimination story.
- **Simpler mental model** — no more "is `ConfigService` in core or in
  config?" lookups.
- **Fewer ordering bugs** — `ConfigService` and `@Value()` now share the
  exact same env resolver path, eliminating the snapshot-vs-lazy class of
  bugs that haunted the standalone package.

## Quick Example (post-migration)

```typescript
import { defineEnv, loadEnv, ConfigService } from '@forinda/kickjs'
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
env.DATABASE_URL // string  — your key
env.PORT         // number  — base key, always present
env.NODE_ENV     // enum    — base key, always present
```

User-defined keys override base keys when they collide, so you can re-type
`PORT` or tighten `NODE_ENV` without losing the rest of the base shape.

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
