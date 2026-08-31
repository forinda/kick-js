---
'@forinda/kickjs-cli': minor
---

`kick g module`: the repository is one file, and it stops lying about what it is.

With `modules.repo: { name: 'postgres' }` the generator emitted
`postgres-audit.repository.ts` whose every method read and wrote an in-memory
`Map` — bound by the module as the live implementation. The filename and class
name both asserted Postgres, so an app could be wired, booted and manually
tested against `PostgresAuditRepository` while every write went to a store that
empties on restart, with nothing in the types or the logs to say so.

**The name was the lie, not the Map.** The store is gone from the generated
names, so an in-memory body is honest: this is the repository, currently in
memory, and the TODO says what to swap in. It still works as generated, which a
throwing stub would not.

**Three files collapsed to one.** `<module>.repository.ts` now holds the
factory, the contract and the token:

```ts
export function createAuditRepository() {
  const store = new Map<string, AuditResponseDTO>()
  return { async findById(id) { … }, … }
}

/** The contract, derived from the factory rather than declared beside it. */
export type AuditRepository = ReturnType<typeof createAuditRepository>

export const AUDIT_REPOSITORY = createToken<AuditRepository>('app/Audit/repository')
```

The return type IS the interface, so an implementation cannot drift from its own
contract, and there is no `IAuditRepository` to keep in step. Swapping stores
means writing another factory with a compatible return type and calling that one
in the module — nothing else changes.

The module registers it declaratively:

```ts
container.registerFactory(AUDIT_REPOSITORY, () => createAuditRepository())
```

Gone with it: the separate interface file, the `InMemory…Repository` class, and
the store-named class. `drizzle` and `prisma` had no dedicated generators either
— both already scaffolded the same stub — so their entries in the name maps were
dead special-casing that produced `DrizzleAuditRepository` for a file containing
no Drizzle.

`modules.repo` is deprecated as a result: the name no longer changes the
generated code, only the TODO inside it. It keeps working, and nothing is
removed without a replacement.
