---
'@forinda/kickjs-db': minor
---

`morphTo` takes options per target: `with: { subject: { withDeleted?, targets: { post: { columns, extras, where, with, withDeleted }, podcast: true } } }`. Each target is one row, so it takes no `orderBy`, `limit` or `offset`; a target's `where` that matches nothing gives `null`. The result is a union shaped per target and narrowed by `__type`. An unknown target, or an option that needs one table given beside `targets`, is refused with what to write instead. On SQLite a `bytea` column named in a target's `columns` is refused; left unnamed, it's skipped.
