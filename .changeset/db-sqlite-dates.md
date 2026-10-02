---
'@forinda/kickjs-db': patch
---

Dates work on SQLite. `timestamp()`, `timestamptz()` and `date()` columns are typed `Date`, but on SQLite they read back as strings and writing a `Date` failed ("SQLite3 can only bind numbers, strings, bigints, buffers, and null"). They now read back as `Date`, and a `Date` is accepted anywhere — insert and update values, `where` clauses, raw `sql` — stored as `YYYY-MM-DD HH:MM:SS.SSS` in UTC (the shape SQLite's own `CURRENT_TIMESTAMP` writes, so old and new values sort together); `date()` columns store `YYYY-MM-DD`. A `customType` codec on a column still takes precedence. Rows nested inside a relational `db.query` result are not decoded yet.
