---
'@forinda/kickjs-db': minor
---

Add `morphMany` and `morphOne` to `relations()`: a polymorphic one-to-many over a type + id column pair (one `comments` table shared by posts and podcasts). `db.query.posts.findMany({ with: { comments: true } })` returns the rows whose type column holds the `as` value and whose id column holds the post's key — typed and queried like `many`, with `where`, `orderBy`, `limit`, `columns` and nested `with`. `references` defaults to the source's single-column primary key. `morphOne` takes the same options and loads one such row, typed like `one` (`Row | null`). No foreign key is created. The relational-queries guide gains a "Polymorphic associations" section comparing exclusive arcs, junction tables and type + id columns.
