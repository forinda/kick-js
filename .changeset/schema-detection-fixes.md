---
'@forinda/kickjs-schema': patch
'@forinda/kickjs-cli': patch
---

Schema detection fixes, and docs that match the code.

- **Callable Standard Schemas:** schemas such as ArkType types are now validated as Standard Schemas. Before, they were treated as plain validator functions, which accepted every value because they return errors instead of throwing.
- **Standard JSON Schema `target` and `io`:** libraries now receive the caller's `target` (default `'draft-2020-12'`) through `jsonSchema.input()` / `output()`, chosen by `io`. Swagger's `openapi-3.0` reaches them, and spec-compliant libraries no longer throw for a missing `target`.
- **Valibot `expected` / `received`:** issues no longer carry the literal string `"null"` when Valibot reports none.
- **`@valibot/to-json-schema`:** now a declared optional peer, installed by `kick new`'s Valibot template. Without it, Valibot schemas are still described as `{ type: 'object' }`, but a one-time warning now says why.
- **CLI:** `kick g config` writes `schemaValidator: 'kickjs-schema'` like `kick new`. Generated Zod DTOs pass messages as `{ error: '…' }` (Zod 4).
- **Generated README:** explains reading env: the schema in `src/config/index.ts` is imported once for its side effect, then values are read anywhere with `getEnv()`, `ConfigService` or `@Value()` (typed with `Env<'KEY'>`) rather than `process.env`. The variable table now lists `LOG_LEVEL`.
- **Generated agent docs:** no longer call `@Controller('/path')` "OpenAPI metadata only". The path was removed in v4 and passing one is a TypeScript error.
