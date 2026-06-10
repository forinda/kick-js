---
'@forinda/kickjs-db': minor
---

Drift detection now works for SQLite and MySQL — `kick db migrate` catches out-of-band schema changes on all three dialects.

SQLite/MySQL introspection is lossy against a code-first snapshot (a `uuid()` column reads back as `text` / `char(36)`, defaults normalise, SQLite drops FK names), so a raw comparison flagged drift on every migration. `checkDrift` now **canonicalises both sides** before diffing: column types run through the emit type-mapper (so `uuid` ≡ `text`), defaults are dropped, and FK names become a structural key. This catches the drift that matters — tables/columns added or removed, type/nullability/PK changes, indexes — without false positives. PostgreSQL still compares raw (faithful round-trip) and keeps default-level drift detection.

**Behaviour change**: SQLite/MySQL `migrate` previously skipped drift entirely (it had no `introspect()`); it now defaults to `'error'` like Postgres. Tune it with the new `db.driftCheck` option (`'error'` | `'warn'` | `'ignore'`) in `kick.config.ts` / `kickjs-db.config.ts`.

Verified end-to-end: a clean SQLite migrate passes the drift check (no false positive on lossy types), while an out-of-band `ALTER TABLE ... ADD COLUMN` is caught ("Schema drift detected: 1 added").
