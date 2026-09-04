---
'@forinda/kickjs-db': patch
---

Fix derived constraint names colliding past Postgres' 63-character limit (#647).

`<table>_<column>_fk` and `<table>_<column>_unique` were emitted at whatever
length they came out. Postgres does not reject an over-long identifier — it
truncates silently — so two derived names sharing a long prefix became the same
name and the migration failed part-way through with `constraint … already
exists`, leaving every statement after it unapplied. A 242-table schema had 38
names over the limit and two colliding pairs.

Derived names that would exceed the limit are now shortened deterministically:
truncated, with a short hash of the **full** name inserted before the `_fk` /
`_unique` marker, so the result is stable across regenerations and two names
that differ anywhere still differ. The limit is counted in bytes and a
multi-byte character is never split. Names within the limit are untouched, so
existing schemas keep every constraint name they have.

`fitIdentifier()` is exported for anyone deriving names on the same rule.
