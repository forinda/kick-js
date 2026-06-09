---
'@forinda/kickjs-cli': major
---

Lean generators: REST + minimal only, name-based repositories, flat scaffold.

**Breaking — project templates.** The `ddd` and `cqrs` generator patterns are removed. `kick new` / `kick g module` now offer only `rest` (the new default) and `minimal`. Projects that passed `--template ddd|cqrs` (or set `pattern: 'ddd'|'cqrs'` in `kick.config.ts`) now generate the flat REST layout. Existing hand-written DDD/CQRS code is untouched — only the generators changed.

**Deprecated — ORM repository presets.** The dedicated `prisma` and `drizzle` repository generators are gone. The repo prompt is now a free-text name: `inmemory` (the zero-dep default, unchanged) or any DB name (e.g. `postgres`, `mongo`) which scaffolds a generic custom-repository stub you wire to your own client. Passing `--repo prisma|drizzle` still works — it just emits the generic stub and prints a deprecation note. Pass a name via `--repo <name>` or `modules.repo: { name: '<name>' }`.

**`kick g scaffold` now emits the flat REST layout** (controller + service + field-aware DTOs + repository) instead of the removed DDD layout. The `--fields name:type` feature is unchanged; the generated in-memory/custom repository now builds entities by spreading the create DTO, so it works for any field set.

To keep DDD/CQRS scaffolding, pin to the previous CLI major.
