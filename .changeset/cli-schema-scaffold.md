---
'@forinda/kickjs-cli': minor
'@forinda/kickjs-swagger': patch
---

`kick new` now scaffolds projects on top of `@forinda/kickjs-schema` instead of the legacy `defineEnv` + raw Zod setup.

**New `--schema` flag.** Pick the env / DTO validation library at scaffold time:

```sh
kick new my-api --schema zod     # default
kick new my-api --schema valibot
kick new my-api --schema yup
```

`--yes` defaults to `zod`. Interactive mode adds a "Schema library" prompt between repo selection and optional packages.

**Generated env file** now uses `loadEnvFromSchema(fromX(...))` so the same `KickSchema` flows through the env loader, the validate middleware, and the swagger spec generator. The default export is the wrapped schema — `kick typegen` reads it via `InferSchemaOutput<typeof _envSchema>` to populate `KickEnv`. The legacy `defineEnv(...)` + `loadEnv(...)` scaffold path is removed.

**Generated `kick.config.ts`** sets `typegen.schemaValidator: 'kickjs-schema'` so typegen routes through `InferSchemaOutput` for any wrapped schema — Zod, Valibot, or Yup all work without changing the typegen config.

**Generated `package.json`** now always installs `@forinda/kickjs-schema` and only the chosen schema lib (`zod` / `valibot` / `yup`), not all three.

**Swagger** adds adapter-integration tests (`packages/swagger/__tests__/schema-detection.test.ts`) covering real Zod / Valibot / Yup schemas through the `@Post('/', { body: ... })` pipeline + OpenAPI spec generation.
