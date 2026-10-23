---
'@forinda/kickjs': minor
---

`urlFor` (on `ctx`, `Application` and `ROUTE_URLS`) also takes a route's params as a list, filled in the order its path has them: `ctx.urlFor('PostsController.show', [user.id, post.slug])`. A wrong count throws, naming the params the route takes.
