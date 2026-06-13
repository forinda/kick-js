---
'@forinda/kickjs': minor
---

Query parsing gains an `onReject` hook, configurable limits, and `ctx.qs()` memoization.

- `parseQuery(query, fieldConfig, options?)` accepts a new `ParseQueryOptions` bag: `maxLimit`, `defaultLimit`, `maxSearchLength`, and `onReject`. The historical silent drop of an unknown filter/sort field — or a truncated search string — now fires `onReject({ kind, field, reason })` so callers can warn, count, or return a 400. Fully backward compatible (the 2-arg form is unchanged).
- `setQueryParsingDefaults({ maxLimit, defaultLimit, maxSearchLength })` replaces the previously hardcoded `MAX_LIMIT = 100` / `MAX_SEARCH_LENGTH = 200` constants with a one-time global override at bootstrap; per-call options still win.
- `ctx.qs(fieldConfig, options?)` threads the options through, **memoizes** the result per request (repeat calls with the same args skip re-parsing), and by default logs rejected fields via `console.warn` with the request id — pass an explicit `onReject` (e.g. one that throws) to override, or `() => {}` to silence.
