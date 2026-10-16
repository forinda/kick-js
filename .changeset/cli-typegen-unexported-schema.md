---
'@forinda/kickjs-cli': patch
---

`kick typegen` no longer emits an import of a route schema that is declared in the controller file but not exported — that import failed the project's typecheck with TS2459 ("declares 'X' locally, but it is not exported"). The field falls back to `unknown` (or the URL / `@ApiQueryParams` shape) and typegen warns, naming the file and saying to export the schema.

The token-name warning now follows the documented `<scope>/<area>/<key>[:<instance>]` convention — a lowercase scope, then slash-separated segments in any case — so `'app/tenants/repository'` and the framework's own `'kick/storage/default'` no longer warn. A bare `'UserRepository'` or a dotted `'app.db'` still does. The message no longer cites an internal design-doc section.
