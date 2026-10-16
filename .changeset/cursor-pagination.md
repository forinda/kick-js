---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': patch
---

Cursor (keyset) pagination: `ctx.paginateCursor(fetcher, fieldConfig?, options?)` reads `?cursor=&limit=` plus the usual filter / sort / `q`, hands the fetcher `{ filters, sort, search, cursor, limit }`, and answers `{ data, meta: { limit, hasNext, nextCursor }, links: { self, next } }`. The fetcher returns up to `limit + 1` rows; the extra one sets `hasNext`. The cursor is unsigned base64url JSON of the last row's sort-field values plus its id (`options.idField`, or `options.cursorKey(row)`), tagged with the sort — a malformed cursor or one replayed under a different `sort` answers 400. Keep filters and authorization scoping in the fetcher so a forged cursor cannot widen access. New types: `CursorPosition`, `CursorValue`, `CursorQuery`, `CursorPaginateOptions`, `CursorPaginatedResponse`; `kick typegen` infers `CursorPaginatedResponse<T>` for `return ctx.paginateCursor(...)`.

`ctx.paginate()` responses gain `links: { self, next, prev }` (`null` at the ends). Links are path + query only — never a host — and keep the request's other parameters.

**Migration:** `PaginatedResponse<T>` now requires `links`. Code that builds a `PaginatedResponse` by hand (rather than through `ctx.paginate`) must add `links`, or type the object as `Omit<PaginatedResponse<T>, 'links'>`.

CLI: the generated in-memory repository gains `findAfter({ cursor, limit, sort, filters, search })` (plus a service passthrough and a repository test), the generated controller's `list` notes how to switch to `ctx.paginateCursor`, and the typed `@ApiQueryParams` query shape accepts `cursor`.
