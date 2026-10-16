---
'@forinda/kickjs-cli': patch
---

`kick new` writes `src/config/index.ts` with `loadEnvFromSchema(envSchema)` as a side effect only — no `export const env`. App code reads env with `getEnv('KEY')` (or `ConfigService` / `@Value`) after the entry's `import './config'`; the default export stays the schema `kick typegen` reads. The generated agent docs teach `getEnv` instead of `env.KEY`.

Existing projects keep working: typegen never read the `env` export, so it can stay or go.
