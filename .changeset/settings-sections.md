---
'@forinda/kickjs': minor
---

`defineSettings(prefix, schema)` defines typed configuration sections, Spring's `@ConfigurationProperties`, for Zod, Valibot or Yup. Each key path reads one env variable under the prefix (`pool.max` → `DB_POOL_MAX`), lists are comma-separated, and `<NAME>_FILE` secrets work. Every section is validated at startup, so an invalid or missing value fails startup and names the variables to fix. A section is injectable by its token (`@Inject(DbSettings)`). Outside DI, `get()` returns the validated value and `load(env?)` parses afresh. On the web entry, sections read the `env` passed to `createWebApp`.
