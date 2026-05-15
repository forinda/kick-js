---
'@forinda/kickjs-devtools': patch
'@forinda/kickjs-devtools-kit': patch
---

fix(devtools): two audit-found correctness wins

**`routeLatency` map no longer grows unboundedly under 404 probing**
(`@forinda/kickjs-devtools`).

The request-tracking middleware keyed `routeLatency` by
`${req.method} ${req.route?.path ?? req.path}` — when no route matched,
the fallback used the raw URL, so every probed 404 path became its own
entry. The samples ring buffer was capped at 1000, but the map itself
had no cap; an attacker hammering random paths could inflate
`/_debug/metrics` payloads and leak memory indefinitely. Unmatched
requests now collapse into a single `<unmatched>` bucket per HTTP
method.

**`DEVTOOLS_BUS` token doc drift** (`@forinda/kickjs-devtools-kit`).

The JSDoc claimed the adapter registered the bus in `beforeStart`, but
it actually registers in `beforeMount`. Doc-only fix — no runtime
change.
