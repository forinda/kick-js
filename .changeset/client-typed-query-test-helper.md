---
'@forinda/kickjs-client': minor
---

feat: typed query strings + `createTestClient`

- Routes with a statically-known query shape (Zod `query` schema or
  `@ApiQueryParams`) now constrain `query` at the call site — sort fields
  autocomplete (`'-createdAt' | 'createdAt' | …`), typos are compile errors.
  Routes without one keep the loose record type.
- `createTestClient(app)` wraps any web-standard app (`createWebApp` result)
  for network-free, fully-typed integration tests; `baseUrl` defaults to
  `http://test/api/v1`.
