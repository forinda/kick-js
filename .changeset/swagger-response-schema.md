---
'@forinda/kickjs': patch
'@forinda/kickjs-swagger': minor
'@forinda/kickjs-cli': minor
---

feat: declared response schemas — one declaration feeds Swagger AND the typed client

```ts
@Get('/', { response: taskSchema })
list() { return this.tasks.all() }
```

- `RouteDefinition.validation.response` (`@forinda/kickjs`): a declared,
  never-runtime-validated response contract
- `@forinda/kickjs-swagger`: the schema documents the auto-generated success
  response (`200`/`201`) as `application/json` content in
  `components/schemas`; explicit `@ApiResponse` entries still win; `204`
  defaults stay body-less
- `kick typegen`: a declared `response` schema overrides return-type inference
  for that route in `KickRoutes[...].response` (both scan paths)

Docs, server types, and the typed client now share one source of truth per route.
