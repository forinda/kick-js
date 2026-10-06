---
'@forinda/kickjs-devtools': minor
---

The API runner prefills a request without the Swagger adapter: `/_debug/routes` now sends each route's body, query and params schemas as JSON Schema (converted with `@forinda/kickjs-schema`, as what the request accepts), and the runner builds the example body, the query rows and the param hints from them. When the Swagger spec documents the route it still wins, for its summaries.
