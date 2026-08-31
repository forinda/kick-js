---
'@forinda/kickjs': patch
---

Export `LoggedRequest` / `LoggedResponse` so the documented middleware layout compiles.

`requestLogger()` types its handler with these two interfaces, and they were
module-private. The documented "keep `src/index.ts` thin" layout builds the
middleware array in `src/middleware/index.ts` and exports it with an inferred
type — which a dependant cannot name:

```
error TS4023: Exported variable 'middleware' has or is using name 'LoggedRequest'
from external module ".../dist/request-logger-D_pf4xzE" but cannot be named.
```

So the recommended project layout walked straight into a compile error, and the
workaround was to annotate with `MiddlewareEntry[]` rather than infer.

Both interfaces are now exported from the package entry. They stay structural
rather than Express's `Request`/`Response` on purpose: the Fastify and h3
runtimes pass a raw Node request, which has `url` but no `path`.

Sibling of the TS4058 leak in #235 — same class, different symbol. Guarded the
same way, by emitting a declaration from a consumer that resolves the built
`.d.mts` by name. That fixture now lives inside the package rather than
`tmpdir()`: from `/tmp` the array trips `TS2883` on Express's own
`ParamsDictionary` first, so the case under test was never reached.
