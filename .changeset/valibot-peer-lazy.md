---
'@forinda/kickjs-schema': patch
---

Fix module-load crash when the `valibot` peer is not installed. `packages/schema/src/adapters/valibot.ts` static-imported `valibot` at the top of the file, so any consumer of `@forinda/kickjs-schema` (including the CLI, which loads `detect.ts` which static-imports every adapter) crashed with `ERR_MODULE_NOT_FOUND` when the peer was absent — even adopters who only used Zod paid the cost.

Switched to top-level `await import('valibot')` inside try/catch (same pattern as the `@valibot/to-json-schema` fix in 0.1.1). When the peer is absent `v` lands at `null` and `fromValibot()` throws a clear error message at call time. When present, behaviour is identical to before.

`isValibotSchema()` works without the peer (pure duck-type), so `detectSchema()` can still skip past a non-Valibot input on a Zod-only project.
