---
'@forinda/kickjs': minor
---

`defineSettings(prefix, schema)` defines typed configuration sections, Spring's `@ConfigurationProperties`, for Zod, Valibot or Yup. Each key path reads one env variable under the prefix (`pool.max` → `DB_POOL_MAX`), lists are comma-separated, and `<NAME>_FILE` secrets work. A section is declared where it's needed: `bootstrap({ settings })`, or `settings()` on a module, adapter or plugin. Declared sections are validated at startup, but only when the declaring unit is mounted, and an invalid or missing value fails startup and names the variables to fix. Each section is injectable by its token (`@Inject(DbSettings)`). `.scoped(name)` gives a second instance under a prefixed name (`ANALYTICS_DB_*`). Outside DI, `get()` returns the validated value and `load(env?)` parses afresh. On the web entry, sections read the `env` passed to `createWebApp`.
