---
'@forinda/kickjs-cli': patch
---

Stop emitting methods, symbol keys and truncated types into the client route map.

A response containing a `Buffer` produced a map that would not parse: 34
`TS1110: Type expected` errors, and nothing downstream could consume it.

Two causes, one symptom. `Buffer` was expanded structurally into a 107-member
interface — `slice`, `write`, `toJSON`, `reduce` and the rest, each hoisted into
its own interface. The overloaded ones fell through to `checker.typeToString`,
which elides long types with `...` by default, and `...` is not type syntax, so
it landed in the `.d.ts` verbatim.

The map describes a JSON response, and `JSON.stringify` drops functions and
symbol keys. A method in this map therefore describes a field the client can
never receive. Properties whose type has call or construct signatures are now
omitted, as are well-known symbol keys — the checker prints those as
`__@toStringTag@138`, whose numeric suffix is compiler state rather than
anything a client could index by, and which would also churn the map's
fingerprint between compiler versions.

The same rule covers what JSON _transforms_, not only what it drops: a type
declaring `toJSON()` is emitted as that method's return type. `Date` becomes
`string` and `Buffer` becomes `{ type: 'Buffer'; data: number[] }` — what the
client actually receives. One app's map carried 496 bare `Date`s, every one of
which let `response.createdAt.getFullYear()` compile against a string. This
assumes the default JSON transport; a client that revives values will have
richer runtime types than the map claims.

Optional methods and optional callbacks are covered too. The checker adds
`undefined` to every optional property, so `save?(): void` arrives as
`(() => void) | undefined`; requiring every union member to be callable kept
those, which then rendered as `onDone?: {}` — and an optional method earned its
own empty hoisted interface. A callable member inside any union is dropped as
well, since `(() => void) | Foo` reaches the client as `Foo` or not at all,
never as an empty object.

Every `typeToString` call now passes `NoTruncation`. Truncated output is never
valid type syntax, so this is unconditional rather than a heuristic.

Data-only types are unaffected — getters are properties, not callables, so they
still serialize and are still emitted; lib types like `Date` were already
emitted by name rather than expanded.

On a 1,940-route app: 34 type errors in the emitted map become 0, hoisted
interfaces drop from 769 to 691, and the `Buffer` case shrinks from 6,850 bytes
of unusable output to 1,280 that type-checks.
