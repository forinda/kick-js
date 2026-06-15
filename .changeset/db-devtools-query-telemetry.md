---
'@forinda/kickjs-db': minor
'@forinda/kickjs-devtools': minor
---

Live `kick/db` query telemetry in DevTools.

- **`@forinda/kickjs-db`** now republishes every successful query to the DevTools event bus as **`db:query`** (`{ sql, parameters, durationMs, dialect }`), alongside the existing `db:slow-query` / `db:query-error`. Zero-overhead when no bus is wired (unchanged). The `db:query` event is added to the `KickDevtoolsEventRegistry` augmentation (`@forinda/kickjs-db/devtools-events`).
- **`@forinda/kickjs-devtools`** gains a **Database** tab: a live recent-query table (time, dialect, duration with slow-query highlight, rows, SQL/error) with SQL filter and headline counters (queries / errors / slow / avg duration). It subscribes to `db:query` (successes) and `db:query-error` (failures) on the shared bus.
