---
'@forinda/kickjs-schema': patch
---

Fix race condition where `fromValibot(...).toJsonSchema()` returned the `{ type: 'object' }` fallback on fast runners (CI). The previous dangling `import('@valibot/to-json-schema').then(...)` resolved asynchronously, so the first `toJsonSchema()` call frequently fired before `_toJsonSchemaFn` got assigned. Replaced with top-level `await import(...)` inside a try/catch — adopters without the peer still land at the same `_toJsonSchemaFn = null` fallback, but adopters who have it installed get the real conversion every time.
