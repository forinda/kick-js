---
'@forinda/kickjs-view': minor
---

A built-in `kvRoute` pipe links templates to the app's routes by name: `href="{{ 'UsersController.show' | kvRoute:user.id }}"`. The arguments fill the route's params in path order, through the request's `ctx.urlFor`, so the API prefix and version are included. Outside a request it fails with a message saying to pass URLs as data. The `kv` prefix (KickJS views) keeps `route` free for an app's own pipe.
