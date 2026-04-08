# Config — moved

The configuration APIs (`defineEnv`, `loadEnv`, `getEnv`, `ConfigService`,
`createConfigService`, `baseEnvSchema`, `resetEnvCache`, `reloadEnv`)
no longer live under `API → Packages` because they are no longer a
standalone package — they ship inside `@forinda/kickjs` itself.

➡️ **See the [Configuration guide](../guide/configuration.md)** for the
full reference and worked examples.

## Quick import map

```ts
// All of these come from the unified package now
import {
  defineEnv,
  loadEnv,
  getEnv,
  reloadEnv,
  resetEnvCache,
  baseEnvSchema,
  ConfigService,
  createConfigService,
} from '@forinda/kickjs'
```

The Vite-only `envWatchPlugin` moved to `@forinda/kickjs-vite`:

```ts
import { envWatchPlugin } from '@forinda/kickjs-vite'
```

::: warning Deprecated package
`@forinda/kickjs-config` still exists as a thin re-export shim for one
release so existing apps don't break — it will be **removed in v3**.
Migrate to `@forinda/kickjs` now.

`.env` file loading is provided by [`dotenv`](https://github.com/motdotla/dotenv),
which is now an **optional peer dependency** of `@forinda/kickjs`. New
projects scaffolded with `kick new` get it pre-installed; existing apps
that rely on `.env` files should add it explicitly:

```bash
pnpm add dotenv
```

Apps that load env via the shell, Docker, or a secret manager don't need
`dotenv` at all.
:::
