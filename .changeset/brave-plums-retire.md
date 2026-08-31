---
'@forinda/kickjs-cli': major
---

`kick add` no longer offers `auth`, `drizzle` or `prisma`.

The three packages behind those entries — `@forinda/kickjs-auth`,
`@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma` — are removed from the repo.
All three were marked `private` and frozen at **6.0.1** while the framework moved
to 7.4, so `kick add auth` installed a package two majors behind the kickjs it
was being added to. The entries carried deprecation warnings; v8 finishes the
job.

`kick add auth|drizzle|prisma` now reports an unknown package rather than
installing one, which is why this is a major for the CLI.

Where each one goes:

| removed                   | replacement                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forinda/kickjs-auth`    | the [BYO Auth recipe](https://kickjs.dev/guide/byo-recipes.html#auth) — `@LoadAuthUser` / `@RequireRole` / `@Public` composed from `defineContextDecorator` and `defineAdapter` |
| `@forinda/kickjs-drizzle` | `@forinda/kickjs-db` (`kick add db` / `pg` / `sqlite` / `mysql`), or wire Drizzle directly                                                                                      |
| `@forinda/kickjs-prisma`  | `@forinda/kickjs-db`, or wire Prisma directly                                                                                                                                   |

The auth decorators went with the package: `@Public`, `@Roles`, `@Can`,
`@Authenticated`, `AuthAdapter` and `AUTH_USER` lived in
`@forinda/kickjs-auth`, never in the framework core. The BYO recipe rebuilds
each of them.

Docs: the Authentication and Authorization guides keep their BYO halves and lose
the legacy package reference they said would go "in a future major" — this is
that major. The Authorization guide now also shows the `user` contributor its
`dependsOn: ['user']` refers to, which was previously only named in passing on
another page. The outdated Roadmap page is removed.
