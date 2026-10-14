# @forinda/kickjs-inertia

[Inertia.js](https://inertiajs.com/) v3 adapter for [KickJS](https://kickjs.app/) —
server-driven pages rendered by React, Vue or Svelte, with server-side
rendering, on Express, Fastify or h3 (v2).

```bash
pnpm add @forinda/kickjs-inertia @inertiajs/react react react-dom
```

The fastest start is the template, which wires everything below:

```bash
kick new my-app --template inertia
```

## Wiring

```ts
// src/index.ts
import { bootstrap, session } from '@forinda/kickjs'
import { InertiaAdapter, inertiaErrorHandler, inertiaNotFound } from '@forinda/kickjs-inertia'

export const app = await bootstrap({
  modules,
  middlewares: [session({ secret: process.env.SESSION_SECRET! })],
  adapters: [
    InertiaAdapter({
      entry: 'src/client/main.tsx', // the file that calls createInertiaApp
      ssr: { entry: 'src/client/ssr.tsx' }, // optional
      errorPage: 'Error', // optional — unknown URLs and thrown errors
      share: (ctx) => ({ user: ctx.user }), // props every page gets
    }),
  ],
  onError: inertiaErrorHandler(), // validation errors → back to the form
  onNotFound: inertiaNotFound(), // unknown URLs → the error page
  notFoundFallthrough: false, // same answers under `kick dev` as in production
})
```

Pages mount at the site root, next to your `/api/v1` modules:

```ts
routes() {
  return { path: '/', prefix: false, version: false, controller: PagesController }
}
```

## Pages

```ts
import { Controller, Get, Post, type RequestContext } from '@forinda/kickjs'
import { defer, flash, inertia, redirect } from '@forinda/kickjs-inertia'

@Controller()
export class PagesController {
  @Get('/posts')
  index() {
    return inertia('Posts/Index', {
      posts: () => this.posts.list(), // called only when sent
      stats: defer(() => this.posts.stats()), // loaded after the page renders
    })
  }

  @Post('/posts', { body: createPostSchema }) // a failed check → props.errors
  async create(ctx: RequestContext) {
    await this.posts.create(ctx.body)
    flash(ctx, { success: 'Post created' })
    return redirect('/posts') // 303
  }
}
```

| Helper                                                                | What it does                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `inertia(component, props, { status, encryptHistory, clearHistory })` | Render a page — HTML on a first visit, JSON on an Inertia visit |
| `optional(fn)` / `always(v)` / `defer(fn, group)` / `merge(v, mode)`  | When a prop is sent                                             |
| `once(fn, { key, ttl })`                                              | Sent once; the client keeps it                                  |
| `scroll(fn, { pageName, matchOn })`                                   | One page of an `<InfiniteScroll>` list                          |
| `redirect(url)` / `back(ctx)`                                         | 303 after a submit; `back` stays on this site                   |
| `location(url)`                                                       | A full browser visit (another site)                             |
| `flash(ctx, data)`                                                    | Data for the next page's `flash`                                |
| `@Middleware(precognitive)`                                           | Live validation for `useForm().validate()`                      |

## What the adapter handles

- The protocol: `X-Inertia` JSON responses, `Vary`, partial reloads, once
  props, infinite scroll, the asset version check (409), redirects that keep a
  `#fragment`, Precognition, 302 → 303 after PUT / PATCH / DELETE.
- Assets: Vite's dev server under `kick dev`; the build manifest, `assets/` and
  `public/` files in production.
- Server-side rendering through Vite in dev and a built bundle in production,
  falling back to client rendering if a render fails.
- Validation errors and flash data through the session.

Requires `@forinda/kickjs` 10 or later.

## License

MIT
