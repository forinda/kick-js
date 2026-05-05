---
'@forinda/kickjs-db-sqlite': patch
'@forinda/kickjs-db-mysql': patch
---

Drop `Kysely` mentions from the adopter-facing README prose on the two new dialect packages so they match the `@forinda/kickjs-db-pg` template.

Both packages still use the underlying engine internally — that's the point of the `*Dialect()` factories — but the README now reads like the rest of the family: "SQLite adapter", "MySQL adapter", with the implementation engine treated as an internal detail. Adopters who need to escape into the underlying surface still do so via the framework's `qb` accessor; nothing about the API surface or runtime behavior changes.

Same sweep applied to `docs/guide/db-extensions.md` (the result-extension internals doc) — "Kysely plugin" reworded to "query-pipeline plugin" / "query-tree transform" so the public guide is engine-agnostic.

No code changes. No public API changes. Patch bump only because npm picks up the updated README on the next publish.
