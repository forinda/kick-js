---
'@forinda/kickjs-db': patch
---

`$extends({ result })` computed fields now run on related rows even when the queried table has no computed fields of its own. Before, `db.query.posts.findMany({ with: { author: true } })` left out `users` computeds on `author` unless `posts` declared one too.
