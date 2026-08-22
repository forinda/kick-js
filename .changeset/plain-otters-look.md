---
'@forinda/kickjs': minor
---

Add `reply.ok(body)` — the 200 sugar alongside `reply.created` / `reply.accepted` / `reply.noContent`.

A bare `return body` already sends 200, but handlers that mix statuses ended up
half-wrapped and half-bare. `reply.ok(body)` lets every branch read the same way
and carries `Reply<200, T>` through response inference exactly like the others.
