---
'@forinda/kickjs-cli': minor
---

`kick g module`: an unimplemented repository stops pretending to be one.

With `modules.repo: { name: 'postgres' }` the generator emitted
`postgres-audit.repository.ts` whose every method read and wrote an in-memory
`Map` — and the module bound it as the live implementation. The filename and the
class name both asserted Postgres, so an app could be wired, booted and manually
tested against `PostgresAuditRepository` while every write went to a store that
empties on restart, with nothing in the types or the logs to say so. The project
also ended up with two in-memory repositories, one of them named after a
database.

Two changes:

**The stub throws.** Every method raises, naming the class, the method, the
store to write against, and the working `InMemory…Repository` to bind
meanwhile. It still `implements I…Repository`, so `tsc` keeps checking the
signatures the real implementation must satisfy.

**It is named for the module, not the store** — `UserRepository` in
`user.repository.impl.ts`, not `PostgresUserRepository`. The module folder
already carries the name, and a class named after a technology it does not
implement is the assertion that made the original bug invisible. `.impl`
because `user.repository.ts` is the interface.

That applies to `drizzle` and `prisma` too. Neither has had a dedicated
generator for some time — both already scaffolded this same stub — so their
entries in the name maps were dead special-casing that produced
`DrizzleUserRepository` for a file containing no Drizzle.

`modules.repo` is deprecated as a result: the name no longer changes the
generated code, only the prose inside it. Only `'inmemory'` still produces a
distinct file. It keeps working, and nothing is removed without a replacement.
