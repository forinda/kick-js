---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

DevTools now shows context contributors applied as decorators (`@LoadTenant` on a class or method). They used to be invisible because they live in controller metadata and only reach the per-route pipelines.

- Each route records its contributor chain in execution order (`RouteMeta.contributors`): `beforeValidation` ones first, each with its source, label, `dependsOn` and the lower-precedence registrations it overrides.
- `app.getRoutes()` lists mounted routes with their chains.
- `app.getContributors()` now includes `class` and `method` sources, once per decorator site.
- In DevTools, `/_debug/routes` carries each route's chain, and the topology keeps contributors of the same key from different sources apart. The Routes tab shows a `ctx N` count per route, and the route panel has a "Context contributors" section listing the full chain however long it is.
