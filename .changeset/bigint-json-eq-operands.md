---
'@forinda/kickjs': minor
'@forinda/kickjs-db': minor
---

**kickjs:** `ctx.json` / `ctx.created` / a returned value send a bigint as its decimal string instead of failing with `TypeError: Do not know how to serialize a BigInt`, on Express, Fastify, h3 and the web entry. Bodies without one serialize as before.

**kickjs-db:** a condition helper (`eq`, `ne`, `gt`…, `like`, `isNull`, `inArray`, `between`…) needs a column or an expression on at least one side. `eq('id', id)` compared the text `'id'` and never matched; it now fails to compile, and throws when the types are bypassed. The row argument of `db.query`'s `where` / `orderBy` is now typed as column references (`u.id` is `Expression<number>`), matching what it is at runtime; code that annotated it with the row type should use `TableRefs<DB, 'table'>` or drop the annotation.
