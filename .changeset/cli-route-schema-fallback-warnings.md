---
'@forinda/kickjs-cli': minor
---

`kick typegen` now warns when a route decorator's wired `body`/`query`/`params` schema cannot be statically resolved and the generated `KickRoutes` type silently falls back to `unknown` (or URL-pattern params). The warning names the controller, method, route, and schema identifier, and suggests exporting the schema with a static import specifier. No warning is emitted when no schema is wired or when `typegen.schemaValidator` is `false`.
