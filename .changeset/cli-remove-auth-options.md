---
'@forinda/kickjs-cli': minor
---

chore(cli): drop @forinda/kickjs-auth from every user-facing CLI surface

`@forinda/kickjs-auth` is no longer offered through the CLI. Adopters who already depend on it keep working — the package itself stays on disk and is unaffected. Only the prompts / scaffolds / registries that proactively suggested it have been pruned. Five surfaces touched:

1. **`kick new` multi-select** — `Auth` removed from the optional-packages prompt (`init.ts`). New projects no longer see it offered.
2. **`kick g auth-scaffold`** subcommand removed (`generate.ts`). The `kick g` Commander tree no longer registers the `auth-scaffold` subcommand. Underlying generator file (`generators/auth-scaffold.ts`) kept on disk for now — orphaned code, can be deleted in a follow-up.
3. **`kick add auth`** registry entry removed (`commands/add.ts`). `kick add --list` no longer surfaces it.
4. **`SIBLING_PACKAGES`** version-lookup list (`generators/project.ts`) — `@forinda/kickjs-auth` removed so `npm view <name> version` isn't queried at scaffold time for a package the CLI no longer offers.
5. **`PACKAGE_DEPS`** alias map (`templates/project-config.ts`) — `auth` key removed.

Imports cleaned up alongside: `generateAuthScaffold`, the local `AuthScaffoldOpts` interface, and the now-unused `select` / `promptConfirm` imports (the only callers were the removed auth-scaffold action).

Documentation references in `project-docs.ts` template (recipes mentioning `@Public()`, `AuthAdapter`, `JwtStrategy`) intentionally kept — those are example prose, not CLI surfaces, and adopters who explicitly install `@forinda/kickjs-auth` still benefit from the recipes.
