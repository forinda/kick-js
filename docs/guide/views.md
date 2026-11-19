<script setup>
// This guide was one page; its sections now have pages of their own. A link
// to an old section (/guide/views#fragments) lands here: send it on.
import { onMounted } from 'vue'
const moved = {
  "templates": "./views/syntax.html",
  "interpolation": "./views/syntax.html#interpolation",
  "expressions": "./views/syntax.html#expressions",
  "control-flow": "./views/syntax.html#control-flow",
  "comments-and-literal-text": "./views/syntax.html#comments-and-literal-text",
  "attributes-and-bindings": "./views/attributes.html#attributes-and-bindings",
  "escaping-and-what-s-refused": "./views/attributes.html#escaping-and-what-s-refused",
  "layouts": "./views/layouts.html",
  "dashboards-layouts-by-folder-and-a-base-layout": "./views/layouts.html#dashboards-layouts-by-folder-and-a-base-layout",
  "stacks": "./views/layouts.html#stacks",
  "components": "./views/components.html",
  "scoped-slots": "./views/components.html#scoped-slots",
  "dynamic-components": "./views/components.html#dynamic-components",
  "components-with-a-script": "./views/client-scripts.html",
  "toast-messages": "./views/client-scripts.html#toast-messages",
  "snippets": "./views/snippets.html",
  "pipes": "./views/pipes.html",
  "links-to-routes": "./views/pipes.html#links-to-routes",
  "your-own-pipes": "./views/pipes.html#your-own-pipes",
  "forms": "./views/forms.html",
  "checking-in-the-browser": "./views/forms.html#checking-in-the-browser",
  "your-own-validators": "./views/forms.html#your-own-validators",
  "your-own-checks": "./views/forms.html#your-own-checks",
  "shared-data": "./views/shared-data.html",
  "assets": "./views/assets.html",
  "partials-and-htmx": "./views/htmx.html",
  "fragments": "./views/htmx.html#fragments",
  "emails-pdfs-and-tests": "./views/emails-and-errors.html#emails-pdfs-and-tests",
  "error-pages": "./views/emails-and-errors.html#error-pages",
  "the-edge": "./views/edge.html",
  "typed-render-data": "./views/typed-render-data.html",
  "formatting-and-checking": "./views/tooling.html#formatting-and-checking",
  "editor-support": "./views/tooling.html#editor-support",
  "options": "./views/options.html"
}
onMounted(() => {
  const to = moved[decodeURIComponent(location.hash.slice(1))]
  if (to) location.replace(to)
})
</script>

# Views (`.kick` templates)

`@forinda/kickjs-view` renders server-side HTML from `.kick` templates. `ctx.render()` works with it on Express, Fastify, h3 and the web fetch entry, including edge platforms with no file system. Values print with `{{ }}` and pipes; logic lives in `@if` / `@for` blocks.

::: warning Experimental
The first releases are `0.x`. The template syntax is settled; the format the build emits may still change between minor versions.
:::

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

```kick
{{-- src/views/users/show.kick --}}
@layout('layouts/main')
<h1>{{ user.name | titlecase }}</h1>
@if (user.isAdmin) {
  <admin-badge />
}
<ul>
  @for (post of posts; let i = $index) {
    <li>{{ i + 1 }}. <a href="/posts/{{ post.id }}">{{ post.title }}</a></li>
  } @empty {
    <li>No posts yet</li>
  }
</ul>
```

```ts
@Get('/:id')
async show(ctx: RequestContext) {
  const user = await this.users.find(ctx.params.id)
  await ctx.render('users/show', { user, posts: user.posts })
}
```

Other template engines (EJS, Pug, Handlebars) keep working through [`ViewAdapter`](./view-engines.md), and one app can use both.

## Setup

`kick add views` does this for you: it installs the package, writes `src/views.ts`, a layout, a `home` page and `src/views/shared.ts` (for [typed render data](./views/typed-render-data.md)), puts the adapter in `src/adapters/views.ts` (`viewsAdapter()`) and adds it to `bootstrap()` in `src/index.ts`, and prints the line that registers `viewCliPlugin` in `kick.config.ts` (for `kick check:views` and `kick fmt:views`). By hand:

```bash
pnpm add @forinda/kickjs-view
```

```ts
// src/views.ts
/// <reference types="@forinda/kickjs-view/virtual" />
import kickViews from 'virtual:kick-views'
import { createViews } from '@forinda/kickjs-view'

export const views = createViews({ ...kickViews, layout: 'layouts/main' })
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { KickView } from '@forinda/kickjs-view'
import { views } from './views'

export const app = await bootstrap({ modules, adapters: [KickView({ views })] })
```

`virtual:kick-views` comes from `@forinda/kickjs-vite` (included in `kickjsVitePlugin()`):

- **`kick build`:** it checks every template and ships them in the build. A template with an error fails the build.
- **`kick dev`:** it hands over only your pipes, and templates are read from `src/views`. An edit shows up on the next request.

Without Vite (plain Node, Bun, Deno), `createViews()` reads `src/views` itself.

## In this guide

- **Templates**
  - [Template syntax](./views/syntax.md): interpolation, expressions, `@if` / `@for` / `@switch`, `@let`, comments
  - [Attributes and escaping](./views/attributes.md): bindings, and what each place escapes or refuses
- **Layout**
  - [Layouts and stacks](./views/layouts.md): `@layout`, slots, layouts by folder, a base layout, `<stack>` / `@push`
- **Components**
  - [Components](./views/components.md): inputs, attribute passthrough, slots that receive data, dynamic components
  - [Components with a script](./views/client-scripts.md): `<script client>`, and toast messages
  - [Snippets](./views/snippets.md): `@snippet` / `@render`
- **Data**
  - [Pipes](./views/pipes.md): the built-ins, links to routes, your own pipes
  - [Shared data](./views/shared-data.md): `share()`, the CSRF token, a CSP nonce
  - [Typed render data](./views/typed-render-data.md): `ctx.render` checked against your templates
- **Forms**
  - [Forms](./views/forms.md): validation, refill, checking in the browser, your own validators and checks
- **Rendering**
  - [Partials, htmx and fragments](./views/htmx.md): `layout: false`, `@fragment`
  - [Assets](./views/assets.md): `@assets` and Vite
  - [Emails, PDFs, tests and error pages](./views/emails-and-errors.md)
  - [Views on the edge](./views/edge.md)
- **Tooling**
  - [Formatting, checking and editors](./views/tooling.md): `kick fmt:views`, `kick check:views`, the VS Code extension
  - [`.kick` in other editors](./view-editors.md)
- **Reference**
  - [Options](./views/options.md): `createViews` and the Vite plugin

## Mixing with EJS or Pug

With `KickView` and [`ViewAdapter`](./view-engines.md) both installed (Express), `ctx.render(name)` renders the `.kick` template when there is one. Otherwise the name goes to `ViewAdapter`.

## Related

- [View Engines](./view-engines.md) — EJS, Pug, Handlebars through `ViewAdapter`
- [Inertia](./inertia.md) — interactive pages with React, Vue or Svelte
- [Edge deployment](./edge-deployment.md)

::::
