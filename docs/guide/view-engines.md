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

The `ViewAdapter` ships with `@forinda/kickjs` -- no extra framework packages needed. You only need to install the template engine of your choice:

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
<head><title><%= title %></title></head>
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
    new ViewAdapter({
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

@Controller('/')
export class HomeController {
  @Get('/')
  index(ctx: RequestContext) {
    ctx.render('home', { title: 'Home', name: 'World' })
  }
}
```

Visit `http://localhost:3000/` and you will see the rendered HTML.

## ViewAdapter Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `engine` | `any` | *required* | The template engine module or a custom render function |
| `ext` | `string` | *required* | File extension for templates (e.g., `'ejs'`, `'pug'`, `'hbs'`) |
| `viewsDir` | `string` | `'src/views'` | Directory containing template files |
| `layout` | `string` | `undefined` | Default layout template (engine-dependent) |

## Engine Examples

### EJS

```ts
import ejs from 'ejs'
import { ViewAdapter } from '@forinda/kickjs/views'

new ViewAdapter({ engine: ejs, ext: 'ejs', viewsDir: 'src/views' })
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

new ViewAdapter({ engine: pug, ext: 'pug', viewsDir: 'src/views' })
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

new ViewAdapter({ engine: engine(), ext: 'handlebars', viewsDir: 'src/views' })
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

new ViewAdapter({ engine: nunjucks, ext: 'njk', viewsDir: 'src/views' })
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

## Build-Time Folder Copying

Template files are not TypeScript, so they are not included in the Vite build output. Use the `copyDirs` option in `kick.config.ts` to copy your views directory into `dist/` after each build:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  copyDirs: [
    'src/views',                              // copies to dist/src/views
    { src: 'src/views', dest: 'dist/views' }, // custom destination
    'src/emails',                             // additional template dirs
  ],
})
```

When you run `kick build`, the CLI copies these directories automatically after Vite finishes. See the [CLI Commands](./cli-commands.md#kickconfigts-reference) page for the full `kick.config.ts` reference.

## Related

- [Adapters](./adapters.md) -- how the adapter lifecycle works
- [Controllers & Routes](./controllers.md) -- controller decorators and `RequestContext`
- [CLI Commands](./cli-commands.md) -- `kick build` and `copyDirs` configuration
