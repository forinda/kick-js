---
'@forinda/kickjs-db': minor
---

Many-to-many in relational reads: `many(tags, { through: postTags })` loads a post's tags through the junction table in the same single query, with `where`, `orderBy`, `limit` and nested `with` like any `many`. The junction's foreign keys decide the join; when it has more than one to a side — a table joined to itself, like `follows` — name them: `{ table: follows, from: [follows.followerId], to: [follows.followeeId] }`. A junction that can't be resolved throws `RelationalQueryThroughError` at client creation.
