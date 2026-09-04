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

A default is now quoted unless the column's type is one where a bare expression
is legitimate — the integer family (`nextval(...)`), numeric, boolean, the
temporal types (`CURRENT_TIMESTAMP`) and uuid (`gen_random_uuid()`). Stating it
as an allow-list rather than its complement matters, because the complement is
open-ended: every enum, domain and extension type an adopter declares falls
outside it. Enum labels are the sharpest case — a label is always a literal, and
one spelled `ACTIVE` or `1` reads as a keyword or a number to any value-shaped
heuristic.

A value already carrying an explicit cast (`'active'::"status"`, composed by the
enum recreate path) is untouched.
