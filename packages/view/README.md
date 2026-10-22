# @forinda/kickjs-view

`.kick` views for [KickJS](https://kickjs.app/): server-rendered HTML templates that work on Express, Fastify, h3 and the edge.

```html
@layout('layouts/main')
<h1>{{ user.name | titlecase }}</h1>
@for (post of posts) {
<post-card [post]="post" />
} @empty {
<p>No posts yet</p>
}
```

- `{{ value | pipe }}`, escaped for where it lands; `@if`, `@for`, `@switch`, `@let`
- layouts (mapped by folder, with a base layout), components with inputs and slots
- pipes for dates, numbers and currency in a locale and time zone
- templates checked at build time, shipped as data — no `eval`, no file system on the edge
- `kick fmt:views` / `kick check:views`

```ts
import kickViews from 'virtual:kick-views'
import { createViews, KickView } from '@forinda/kickjs-view'

const views = createViews({ ...kickViews, layout: 'layouts/main' })
bootstrap({ modules, adapters: [KickView({ views })] })

// in a controller
await ctx.render('users/show', { user })
```

Experimental while 0.x. Guide: [kickjs.app/guide/views](https://kickjs.app/guide/views).

## License

MIT
