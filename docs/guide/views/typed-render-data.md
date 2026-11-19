# Typed Render Data

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

`kick typegen` (and `kick dev`) reads every page and writes `.kickjs/types/kick__views.ts`. From then on `ctx.render` and `views.render` accept only real template names, and the data must include what the page reads:

```ts
await ctx.render('users/show', { user }) // ok
await ctx.render('users/shwo', { user }) // error: no such template
await ctx.render('users/show', {}) // error: 'user' is missing
```

What the types come from:

- **Names a page reads** (`{{ user.name }}`, `[href]="post.url"`, `@for (p of posts)`) are required, shaped by how they're read: `user` is `{ name: unknown }`, `posts` an iterable of whatever `p` reads. Values the template only prints stay `unknown`.
- **A tested name may be `null`**: inside `@if (user) { … }` (and an `@else` after `@if (!user)`), `user && user.name`, `user ? … : …`, and `@for` sources. So `findById(): User | null` passes straight in. The name must still be passed: a missing one warns at render.
- **`??` and `?.` let a name be left out**: `user ?? 'guest'`, `user?.name`.
- **`$index` and the other loop variables**, `@let`s and `@for` items are the template's own, never data; reading through an alias (`@let u = user`) types `user`.
- **Extra keys are fine**, and form state (`$errors`, `$old`, `$flash`) is never asked for.
- **A fragment render** (`{ fragment: 'row' }`) takes only what that fragment reads. Its needs (names bound around it, like a loop's item) must come from the controller, so `KickViewShared` doesn't cover them, just as `share()` doesn't at render.
- **Layouts:** the reads of a page's own `@layout(...)` chain are included. Layouts from the `layout` mapping or `baseLayout` aren't (typegen can't see `createViews`); those usually read shared names, below.

**Tighter types**, page by page: declare the data with `@input`, importing the types it uses.

```kick
@import type { User } from '@/domain/user'
@input user: User
@input title: string = 'Users'
<h1>{{ title }}</h1>
```

A declared type replaces the inferred one. A default makes the name optional and fills it in when nobody passes it; the page's layouts see it too, and `share()` or the controller override it. A layout's own `@input` defaults work the same way, under the page's. A relative import path is relative to the template.

**Shared names**: list what `createViews({ share })` supplies once, so controllers needn't pass it. `kick add views` writes this file (a `.ts`, so a mistake in it is reported):

```ts
// src/views/shared.ts
declare module '@forinda/kickjs' {
  interface KickViewShared {
    user: { name: string } | undefined
    csrfToken: string
  }
}
declare module '@forinda/kickjs-view' {
  interface KickViewShared {
    user: { name: string } | undefined
    csrfToken: string
  }
}
export {}
```

**Other engines**: once the registry exists, a name it doesn't know is an error. An app that also renders EJS or Pug through [`ViewAdapter`](../view-engines.md) opts out of that check, which also lets a misspelled `.kick` name compile:

```ts
declare module '@forinda/kickjs' {
  interface KickViewTypeOptions {
    otherEngines: true
  }
}
```

The view package declares the same interfaces for `views.render` outside an app (emails, the edge); typegen fills whichever of `@forinda/kickjs` and `@forinda/kickjs-view` you have installed.

::::
