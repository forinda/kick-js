---
'@forinda/kickjs-db': patch
'@forinda/kickjs-testing': patch
'@forinda/kickjs-view': patch
'@forinda/kickjs-vite': patch
---

Review follow-ups:

- `kick db --config ""` is an error instead of meaning the db block; a file with neither a `db` block nor db settings (a kick.config without `db`) is refused; a missing file's error shows the absolute path it looked at.
- `useTestDb` with a `migrationsDir` and no Postgres or MySQL server throws instead of running server migrations on SQLite; pass `dialect: 'sqlite'` for SQLite migrations.
- A test template database is keyed only by the files a migration run reads, so flipping `meta.json`'s review flag no longer rebuilds it.
- `@forinda/kickjs-cli-kit` is no longer a runtime dependency of `@forinda/kickjs-testing`.
- `createViews({ roots })` checks root names when it's called. A `layout` map key `'billing::'` covers a whole view root.
- The Vite plugin warns when kick.config fails to load instead of silently using the defaults.
