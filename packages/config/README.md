# @forinda/kickjs-config — DEPRECATED

This package is a thin re-export shim. Everything moved into the unified `@forinda/kickjs` package and will be removed in v3.

## Migration

```diff
- import { defineEnv, loadEnv, ConfigService, getEnv } from '@forinda/kickjs-config'
+ import { defineEnv, loadEnv, ConfigService, getEnv } from '@forinda/kickjs'
```

The Vite-only `envWatchPlugin` moved to `@forinda/kickjs-vite`.

`.env` loading is provided by `dotenv` — now an optional peer of `@forinda/kickjs`. Apps that load env via shell / Docker / secret manager don't need it; apps that rely on `.env` files should `pnpm add dotenv`.

## Documentation

[forinda.github.io/kick-js/guide/configuration](https://forinda.github.io/kick-js/guide/configuration)

## License

MIT
