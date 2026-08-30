---
'@forinda/kickjs-cli': major
---

Drop the Prisma/Drizzle repository config, and say why `--repo prisma` no longer presets

BREAKING: `modules.prismaClientPath` is removed. It was part of the exported
`ModuleConfig`, so an existing `kick.config.ts` that sets it now fails to
typecheck — delete the line, it did nothing. It was threaded through four layers —
`kick.config.ts` → module options → `ModuleContext` → `TemplateContext` — and
consumed by nothing: dead plumbing left behind when the ORM templates were
taken out, and a Prisma-specific knob in the framework's own config.

A repository shaped to Prisma or Drizzle is that library's interface, not
KickJS's, and a generator for it is a promise to track someone else's API
across versions. `--repo prisma` and `--repo drizzle` still scaffold — as the
generic custom-repository stub every other name produces — and the deprecation
note now explains that reasoning instead of just saying "deprecated".

`@forinda/kickjs-prisma` and `@forinda/kickjs-drizzle` are unaffected: adapters
that wire an ORM into DI are first-party code with a first-party interface.
This is only about generating repository _code_ shaped to a third-party API.
