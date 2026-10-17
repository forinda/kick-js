# View Engines

KickJS supports server-side template rendering through the **ViewAdapter**. It works with any Express-compatible template engine, including EJS, Pug, Handlebars, and Nunjucks.

## Why Use a View Engine?

While KickJS is primarily an API framework, some use cases benefit from server-rendered HTML:

- **Admin dashboards** that don't need a full SPA
- **Email templates** rendered before sending
- **PDF generation** from HTML templates
- **Server-side rendered pages** for SEO or lightweight UIs
- **Error pages** with styled HTML instead of raw JSON

The `ViewAdapter` registers a template engine with the underlying Express app and exposes `ctx.render()` in your controllers.

## Installation

The `ViewAdapter` ships with `@forinda/kickjs`. Import it from the main barrel or the sub-path `@forinda/kickjs/views`. It runs on the **Express** runtime only. Fastify and h3 have no view engine, and `ctx.render()` throws there ([HTTP Runtimes](./http-runtimes.md)).

You only need to install the template engine of your choice, and its types for TypeScript (`@types/ejs`, `@types/pug`, `@types/nunjucks`; express-handlebars ships its own):

::: code-group

```bash [EJS]
pnpm add ejs
```

```bash [Pug]
pnpm add pug
```

```bash [Handlebars]
pnpm add express-handlebars
```

```bash [Nunjucks]
pnpm add nunjucks
```

:::

## Quick Start (EJS)

### 1. Create a template

Create `src/views/home.ejs`:

```html
<!DOCTYPE html>
<html>
  <head>
    <title><%= title %></title>
  </head>
  <body>
    <h1>Welcome, <%= name %>!</h1>
    <p>Rendered by KickJS + EJS</p>
  </body>
</html>
```

### 2. Register the ViewAdapter

```ts
import ejs from 'ejs'
import { ViewAdapter } from '@forinda/kickjs/views'
import { bootstrap } from '@forinda/kickjs'

bootstrap({
  modules,
  adapters: [
    ViewAdapter({
      engine: ejs,
      ext: 'ejs',
      viewsDir: 'src/views',
    }),
  ],
})
```

### 3. Render from a controller

```ts
import { Controller, Get } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'

@Controller()
export class HomeController {
  @Get('/')
  index(ctx: RequestContext) {
    ctx.render('home', { title: 'Home', name: 'World' })
  }
}
```

Visit `http://localhost:3000/` and you will see the rendered HTML.

::: tip Pair with the Asset Manager
If you want type-safe references to individual templates (autocomplete + compile-time errors on typo'd template names), declare the views directory under `assetMap` in `kick.config.ts` and use `assets.views.dashboard()` instead of hand-rolling paths. See the [Asset Manager guide](asset-manager.md). The two work together — `ViewAdapter` registers the engine + sets the views directory; the asset manager gives you typed references when your code resolves a specific template path.
:::

## ViewAdapter Options

| Option     | Type     | Default       | Description                                                    |
| ---------- | -------- | ------------- | -------------------------------------------------------------- |
| `engine`   | `any`    | _required_    | The template engine module or a custom render function         |
| `ext`      | `string` | _required_    | File extension for templates (e.g., `'ejs'`, `'pug'`, `'hbs'`) |
| `viewsDir` | `string` | `'src/views'` | Directory containing template files                            |
| `layout`   | `string` | `undefined`   | Default layout template (engine-dependent)                     |

## Engine Examples

### EJS

```ts
import ejs from 'ejs'
import { ViewAdapter } from '@forinda/kickjs/views'

ViewAdapter({ engine: ejs, ext: 'ejs', viewsDir: 'src/views' })
```

Template (`src/views/dashboard.ejs`):

```html
<h1><%= title %></h1>
<ul>
  <% for (const item of items) { %>
  <li><%= item.name %> &mdash; <%= item.status %></li>
  <% } %>
</ul>
```

### Pug

```ts
import pug from 'pug'
import { ViewAdapter } from '@forinda/kickjs/views'

ViewAdapter({ engine: pug, ext: 'pug', viewsDir: 'src/views' })
```

Template (`src/views/dashboard.pug`):

```pug
h1= title
ul
  each item in items
    li #{item.name} &mdash; #{item.status}
```

### Handlebars

```ts
import { engine } from 'express-handlebars'
import { ViewAdapter } from '@forinda/kickjs/views'

ViewAdapter({ engine: engine(), ext: 'handlebars', viewsDir: 'src/views' })
```

Template (`src/views/dashboard.handlebars`):

```handlebars
<h1>{{title}}</h1>
<ul>
  {{#each items}}
    <li>{{this.name}} &mdash; {{this.status}}</li>
  {{/each}}
</ul>
```

### Nunjucks

```ts
import nunjucks from 'nunjucks'
import { ViewAdapter } from '@forinda/kickjs/views'

// Configure nunjucks with the views directory
nunjucks.configure('src/views', { autoescape: true })

ViewAdapter({ engine: nunjucks, ext: 'njk', viewsDir: 'src/views' })
```

Template (`src/views/dashboard.njk`):

```html
<h1>{{ title }}</h1>
<ul>
  {% for item in items %}
  <li>{{ item.name }} &mdash; {{ item.status }}</li>
  {% endfor %}
</ul>
```

## Template File Structure

A typical views directory looks like this:

```
src/
  views/
    layout.ejs              # Shared layout (header, footer, nav)
    pages/
      home.ejs
      dashboard.ejs
      settings.ejs
    partials/
      header.ejs
      footer.ejs
      sidebar.ejs
    emails/
      welcome.ejs
      reset-password.ejs
```

## Passing Data to Templates

The second argument to `ctx.render()` is a plain object. All properties become available as local variables in the template:

```ts
@Get('/dashboard')
async dashboard(ctx: RequestContext) {
  const user = await this.userService.findById(ctx.params.id)
  const stats = await this.statsService.summary()

  ctx.render('pages/dashboard', {
    title: 'Dashboard',
    user,
    stats,
    isAdmin: user.role === 'admin',
  })
}
```

In EJS, these are accessed directly:

```html
<h1><%= title %></h1>
<p>Hello, <%= user.name %></p>
<% if (isAdmin) { %>
<a href="/admin">Admin Panel</a>
<% } %>
```

## In production

Template files are not TypeScript, so the Vite build leaves them out. Copy them into `dist/` with `copyDirs` in `kick.config.ts`:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  copyDirs: ['src/views'], // → dist/src/views, after every `kick build`
})
```

`ViewAdapter` looks for `viewsDir` in two places, in order:

1. The project: `src/views` from the folder the server starts in, which is the source in development.
2. Beside the running entry file: `node dist/index.js` looks in `dist/src/views`, where `copyDirs` put them.

So a deployment that holds only `dist/` and `node_modules`, like the `Dockerfile` `kick g deploy docker` writes, renders from the copy. If you copy to another destination (`{ src: 'src/views', dest: 'dist/views' }`), point `viewsDir` at it in production.

**Netlify and Vercel.** The function bundle holds code, not templates. List the folder in `deploy.include` so it ships with the function:

```ts
export default defineConfig({
  copyDirs: ['src/views'],
  deploy: { include: ['src/views'] },
})
```

The function sets `KICK_APP_ROOT` to where included files land, and `ViewAdapter` looks there first. See [Serverless](./serverless.md#when-you-need-something-else).

## Related

- [Adapters](./adapters.md) -- how the adapter lifecycle works
- [Controllers & Routes](./controllers.md) -- controller decorators and `RequestContext`
- [CLI Commands](./cli-commands.md) -- `kick build` and `copyDirs` configuration
- [Deploying](./deployment.md) -- Docker and Node hosts
