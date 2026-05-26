---
'@forinda/kickjs-schema': minor
'@forinda/kickjs': minor
'@forinda/kickjs-swagger': patch
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-cli': minor
---

Schema-agnostic validation abstraction

**New package: `@forinda/kickjs-schema`**

- `KickSchema` interface — unified `safeParse()`, `toJsonSchema()`, `_raw`
- `SchemaIssue` — normalized error format (path, message, code, expected, received)
- `detectSchema()` — auto-detects KickSchema, Zod, Valibot, Yup, Standard Schema v1, functions, and duck-typed schemas
- `registerAdapter()` — plug in custom schema libraries at runtime
- `InferSchemaOutput<T>` — type-level inference for Zod, Valibot, Standard Schema, and KickSchema

**Adapters (tree-shakable sub-exports):**

- `@forinda/kickjs-schema/zod` — `fromZod()` with full issue normalization and JSON Schema via `.toJSONSchema()`
- `@forinda/kickjs-schema/valibot` — `fromValibot()` with issue mapping and JSON Schema via `@valibot/to-json-schema`
- `@forinda/kickjs-schema/yup` — `fromYup()` with `validateSync` error mapping and JSON Schema from `describe()` metadata

**Framework integration:**

- `validate()` middleware uses `detectSchema()` — accepts any supported schema library
- Swagger `SchemaParser` uses `detectSchema().toJsonSchema()` instead of Zod-specific conversion
- MCP adapter uses `detectSchema()` for tool input/output schema conversion
- `loadEnvFromSchema()` — schema-agnostic env loader alongside existing Zod-only `loadEnv()`

**Typegen:**

- New `schemaValidator: 'kickjs-schema'` option emits `InferSchemaOutput<>` for route body/query/params and env types
- Default `'zod'` unchanged — fully backward compatible
- CLI: `kick typegen --schema-validator kickjs-schema`
