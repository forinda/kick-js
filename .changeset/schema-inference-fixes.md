---
'@forinda/kickjs-schema': minor
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
---

Fix schema-driven env typing end-to-end across `@forinda/kickjs-schema`, `loadEnvFromSchema`, and `kick typegen`.

**`@forinda/kickjs-schema`**

- `fromZod` / `fromValibot` / `fromYup` now infer their output type from the wrapped schema via `InferSchemaOutput<TSchema>`. Previously the `<TOutput = unknown>` generic defaulted to `unknown` whenever the caller didn't spell the output type explicitly — every wrapped schema landed at `KickSchema<unknown>` and propagated `unknown` into `KickEnv`. The explicit `<TOutput>` overload was dropped because TypeScript overload resolution always picked it with `TOutput = unknown` before reaching the inferring overload; adopters who want to spell the output type explicitly can cast (`fromZod(s) as KickSchema<MyShape>`) instead.
- `InferSchemaOutput<T>` now resolves the Standard Schema brand (`~standard.types.output`) before Zod's `_output` (Zod v4 sometimes types `_output` as `never` on object schemas, which would mask the real shape), and adds a final branch for Yup's `__outputType`.

**`@forinda/kickjs`**

- `loadEnvFromSchema` now takes `<TSchema>(schema: TSchema): InferSchemaOutput<TSchema>` so the call site lands at the real env shape instead of `Record<string, unknown>`. A second overload preserves the `Record<string, unknown>` fallback for adopters who pass a runtime-only validator with no static brand.

**`@forinda/kickjs-cli`**

- `kick typegen` env-file detection regex broadened to match `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` / `loadEnvFromSchema(...)` in addition to the legacy `defineEnv(...)`. Projects migrating off `defineEnv` to the schema-agnostic loader no longer get a silent `kick/env: skipped`.
- Env renderer flattens the kickjs-schema inference via a mapped-type identity (`type _Resolved = { [K in keyof _Raw]: _Raw[K] }`) so `interface KickEnv extends _Resolved {}` lands at an object type TS accepts. Without it, `InferSchemaOutput<typeof envSchema>` stays as a conditional type and the interface extension errors with TS2312 ("interface can only extend an object type with statically known members") even when the conditional resolves to a plain object.
