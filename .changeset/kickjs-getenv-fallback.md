---
'@forinda/kickjs': major
---

`getEnv(key, fallback)`: the second argument is now a fallback value, returned when the key is unset (`undefined` or `null`), e.g. `getEnv('S3_REGION', 'eu-west-1')`. The env schema is registered once with `loadEnv(envSchema)` and is the one source of truth.

`ConfigService.get(key, fallback)` (and `createConfigService`'s `get`) take the same fallback.

The `getEnv(key, schema)` overload is removed from the types. At runtime a schema passed the old way still works, with a one-time deprecation warning. Migrate to `loadEnv(envSchema)` once, then plain `getEnv(key)`.
