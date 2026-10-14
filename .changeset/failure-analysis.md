---
'@forinda/kickjs': minor
---

Startup failures come with advice. When an adapter's `beforeMount` or `beforeStart` throws, the app logs what went wrong and what to change, naming the failing hook, before the error itself. Built-in advice covers refused connections, unknown hosts, timeouts and rejected credentials, including through `cause` chains and `AggregateError`s. Adapters can explain their own failures first with `analyzeFailure(err)`. The original error is still thrown unchanged.
