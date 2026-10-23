---
'@forinda/kickjs-view': minor
---

A built-in `kroute` pipe links templates to the app's routes by name: `href="{{ 'UsersController.show' | kroute:user.id }}"`. The arguments fill the route's params in path order, through the request's `ctx.urlFor`, so the API prefix and version are included. Outside a request it fails with a message saying to pass URLs as data. The `k` keeps `route` free for an app's own pipe.
