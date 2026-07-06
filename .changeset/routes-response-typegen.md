---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
---

feat: response type inference — `KickRoutes[...].response` is now real

`kick typegen` emits each route's `response` as a type reference to the
controller handler itself:

```ts
response: import('@forinda/kickjs').InferHandlerResponse<_C0['get']>
```

Your tsc computes the actual type — the scanner stays checker-free and
watch-fast. Return-value handlers yield their exact payload
(`Reply<201, Task>` unwraps to `Task`); imperative `ctx.json` handlers
degrade to `unknown` exactly as before.

- `@forinda/kickjs`: new `InferHandlerResponse<H>` type (exported from the
  root, `/web`, and the http barrel)
- `@forinda/kickjs-cli`: hoisted controller `import type` per (file, class),
  default-export controllers use a `default as` binding;
  `DiscoveredRoute.controllerIsDefaultExport` on both scan paths (AST + regex)
