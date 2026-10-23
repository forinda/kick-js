---
'@forinda/kickjs-view': minor
---

A built-in `route` pipe links templates to the app's routes by name: `href="{{ 'UsersController.show' | route:user.id }}"`. The arguments fill the route's params in path order, through the request's `ctx.urlFor`, so the API prefix and version are included. Outside a request it fails with a message saying to pass URLs as data. `route` is now a built-in pipe name, so an app pipe named `route` must be renamed.
