---
'@forinda/kickjs': minor
---

Job context: `registerJobContext({ key, capture, restore })` carries a value from where a job is dispatched to its handler — a tenant, a trace id, the acting user.

- `stampJobContext(data)` adds the captured values to a job's plain-object data, under `__kickContext`. A `JobDispatcher` implementation calls it before enqueueing.
- `runJob` takes the context off the data, so the handler never sees the field, and runs the handler inside each carrier's `restore`.
- Exported from the root and from `@forinda/kickjs/web`.
