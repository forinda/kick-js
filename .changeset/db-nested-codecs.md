---
'@forinda/kickjs-db': patch
---

Rows that `db.query` nests under a relation now decode like top-level rows: a `customType` column comes back through its `fromDriver` codec on every dialect (a JSON-text list used to arrive as the raw string), and on SQLite nested dates are `Date` and nested decimals are exact strings. An ordinary column that shares a relation's name keeps its stored value.
