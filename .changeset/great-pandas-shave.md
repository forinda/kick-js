---
'@forinda/kickjs-db': patch
---

Fix `kick db generate` emitting invalid SQL for text-column defaults (#646).

`formatDefault` decided how to render a default from the **value's** shape
rather than the **column's** type, so anything that looked like SQL was passed
through bare. A `varchar` column defaulting to `ACTIVE` produced
`DEFAULT ACTIVE` — a syntax error — and the same applied to a text default that
reads as a number (`0800`), a boolean (`true`), or a function call.

This is not hypothetical for round-trips: introspect strips the quotes and cast
off `'ACTIVE'::text`, so the snapshot legitimately holds the bare word and only
the column type says how to put it back.

Defaults on text-shaped columns (`text`, `varchar`, `char`, `json`, `jsonb`, and
arrays of them) are now always quoted; expression defaults still pass through on
the types that actually have them — `CURRENT_TIMESTAMP` on a timestamp,
`gen_random_uuid()` on a uuid. A value already carrying an explicit cast
(`'active'::"status"`, composed by the enum recreate path) is untouched.
