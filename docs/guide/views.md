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

## Templates

Templates live in `src/views/**/*.kick`. `ctx.render('users/show')` renders `src/views/users/show.kick`. A name is folders and a file name made of letters, digits, `-` and `_`. Any other name, including `..` or an absolute path, is refused, even when it comes from a request.

### Interpolation

`{{ expression }}` prints a value, escaped for where it lands:

| value                   | prints                                                        |
| ----------------------- | ------------------------------------------------------------- |
| string                  | escaped                                                       |
| number, bigint, boolean | as text (`true`)                                              |
| `null`, `undefined`     | nothing                                                       |
| `Date`                  | ISO string — use `\| date` for display                        |
| array, object, Promise  | nothing, with a warning in dev (an error with `strict: true`) |

`{{ html | raw }}` prints trusted HTML unescaped. `raw` must be the whole expression's last pipe, and it isn't allowed in attributes, `<title>` or `<textarea>`.

### Expressions

Templates read data; controllers compute it. An expression can use:

- property paths: `user.name`, `user?.address?.city`, `items[0]`, `row[key]`
- literals: `'text'`, `"text"`, `42`, `-1.5`, `true`, `false`, `null`
- `!`, `-`, `+`, `-`, `<`, `>`, `<=`, `>=`, `==`, `!=`, `&&`, `||`, `??`, `a ? b : c`
- pipes: `price | currency:'KES':'1.2-2'`

Calls, assignment, `new`, `* / %`, arrow functions and object or array literals are compile errors. Methods and other functions read as `undefined`, and `__proto__` / `constructor` / `prototype` are never reachable.

`==` and `!=` are strict (`1 == '1'` is false). Truthiness follows JavaScript, so an empty array is truthy: write `@if (items.length)`, or use `@for … @empty`.

Pipes bind loosest: `a ? b : c | upper` pipes the whole conditional. A conditional pipe argument needs parentheses.

| precedence, low to high |
| ----------------------- |
| `\|`                    |
| `? :`                   |
| `??`                    |
| `\|\|`                  |
| `&&`                    |
| `==` `!=` `===` `!==`   |
| `<` `>` `<=` `>=`       |
| `+` `-`                 |
| `!` `-` (unary)         |
| `.` `?.` `[]`           |

A name the data doesn't have prints nothing and logs a warning in dev. With `strict: true` it's an error.

### Control flow

```kick
@if (user.isAdmin) {
  …
} @else if (user; as u) {
  Hi {{ u.name }}
} @else {
  …
}

@for (item of items; track item.id; let i = $index, last = $last) {
  …
} @empty {
  …
}

@switch (order.status) {
  @case ('paid') {
    Paid
  }
  @case ('due') {
    Due
  }
  @default {
    Unknown
  }
}

@let total = order.subtotal + order.shipping;
```

- `@for` loops over arrays, `Set`s, strings, and `Map`s (`@for ([key, value] of map)`). A plain object needs `| entries`. `null` shows `@empty`.
- Loop variables: `$index`, `$first`, `$last`, `$even`, `$odd`, `$count`.
- `track` is accepted and ignored.
- A line holding only `@if (…) {` or `}` leaves no blank line in the output.

### Comments and literal text

- `{{-- not in the output --}}` is a template comment. HTML comments are kept, and can't contain `{{ }}`.
- `@` starts a block only before a keyword in text, so `hi@example.com` and Alpine's `@click="…"` stay as written.
- A literal `}` inside a block is `&#125;`.
- `@verbatim { … }` outputs its content untouched, for pages that ship Vue, Alpine or Handlebars templates to the browser.

## Attributes and bindings

```kick
<a href="/users/{{ user.id }}">profile</a>
<button [disabled]="!canEdit">Save</button>
<li class="item" [class.active]="item.id == current">…</li>
<div [style.width.px]="progress">…</div>
```

- `[attr]="expr"` drops the attribute for `null`, `undefined` or `false`, and writes it bare for `true`.
- `[class.name]` adds a class when the value is truthy.
- `[style.prop]` (`.px` and other units allowed) sets one property. A value that could leave its property (`;`, `url(`, quotes) is dropped.
- `class` and `style` themselves can't be interpolated; use the bindings.

## Escaping and what's refused

| where `{{ }}` lands                                                                                                                                                | what happens                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| text, `<title>`, `<textarea>`                                                                                                                                      | HTML-escaped                                                                                     |
| a quoted attribute                                                                                                                                                 | HTML-escaped                                                                                     |
| a URL attribute (`href`, `src`, `action`, `srcset`, …)                                                                                                             | also scheme-checked: anything but `http`, `https`, `mailto`, `tel` or a relative URL becomes `#` |
| `<script type="application/json">{{ data \| json }}</script>`                                                                                                      | JSON escaped so it can't close the script                                                        |
| any other `<script>` / `<style>` content, `on*` attributes, `style`, `srcdoc`, a refresh `<meta>`, an HTML comment, an unquoted attribute, a tag or attribute name | compile error                                                                                    |

`<script src="{{ cdn }}" nonce="{{ cspNonce }}">` is fine: only a script's content is refused.

## Layouts

```kick
{{-- src/views/layouts/main.kick --}}
<!doctype html>
<html>
  <head>
    <slot name="head"><title>My app</title></slot>
  </head>
  <body>
    <slot />
  </body>
</html>
```

```kick
{{-- src/views/about.kick --}}
@layout('layouts/main')
@slot('head') {
  <title>About</title>
}
<h1>About us</h1>
```

A page renders into its layout's `<slot />`. `@slot('name') { … }` fills a named slot, replacing the slot's fallback content. Layouts can declare their own `@layout` and nest.

### Dashboards: layouts by folder, and a base layout

```ts
createViews({
  ...kickViews,
  layout: {
    admin: 'layouts/admin', // admin/** pages
    'admin/reports': 'layouts/reports', // the longest prefix wins
    seller: 'layouts/seller',
    '': 'layouts/page', // everything else
  },
  baseLayout: 'layouts/base',
})
```

- **`layout` mapping:** a page that declares no `@layout` gets the layout of the longest folder prefix matching its name. Each dashboard keeps its own layout without every page repeating it.
- **`baseLayout`:** the HTML shell, with CSS, `@assets` and SEO tags, wrapped around every page's outermost layout, so the dashboard and page layouts don't each have to include it. A page fills the base's slots (`@slot('head') { … }`) through whatever layouts sit in between.
- **Precedence:**
  1. `ctx.render(name, data, { layout: false })` renders no layout at all, for htmx and other partial responses.
  2. `{ layout: 'layouts/print' }` picks one layout for this render.
  3. `@layout(none)` in the page skips layouts, base included.
  4. `@layout('…')` in the page.
  5. The mapping.
  6. The base alone.

## Components

```kick
{{-- src/views/components/user-card.kick --}}
@input user
@input compact = false
<div class="card">
  <strong>{{ user.name }}</strong>
  @if (!compact) {
    <p>{{ user.email }}</p>
  }
  <slot>No details</slot>
  <footer><slot name="footer" /></footer>
</div>

{{-- in a page --}}
@for (u of users; track u.id) {
  <user-card [user]="u" compact class="mb-2">
    Joined {{ u.joined | date:'mediumDate' }}
    @slot('footer') {
      <a href="/users/{{ u.id }}">Open</a>
    }
  </user-card>
}
```

- A tag with a hyphen that matches `src/views/components/<path>.kick` is a component. Folders join with `-`, so `components/forms/text-field.kick` is `<forms-text-field>`. The component's content replaces the tag.
- `@input name` is required; `@input name = value` has a default.
  - `[name]="expr"` passes an expression, `name="text"` a string, and a bare `name` `true`.
  - `compact="false"` passes the string `"false"`, which is truthy, so write `[compact]="false"`.
  - Kebab-case (`user-id="1"`) binds `userId`.
  - A missing or unknown input fails the check.
- `class`, `id`, `style`, `role`, `aria-*` and `data-*` on the tag go to the component's single root element, with classes merged.
- A component sees only its inputs. Content passed between its tags uses the page's data.
- Components can include themselves (trees), up to 64 levels deep.

## Pipes

| pipe                                  | example                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `uppercase`, `lowercase`, `titlecase` | `{{ name \| titlecase }}`                                                                                                                    |
| `date:format:timeZone?`               | `{{ at \| date:'short' }}` — `short`, `medium`, `long`, `full`, `shortDate`, `mediumDate`, `longDate`, `fullDate`, `shortTime`, `mediumTime` |
| `number:digits`                       | `{{ n \| number:'1.0-2' }}` — `minInt.minFrac-maxFrac`                                                                                       |
| `currency:code:digits?`               | `{{ price \| currency:'KES' }}`                                                                                                              |
| `percent:digits?`                     | `{{ ratio \| percent }}`                                                                                                                     |
| `slice:start:end`                     | `{{ items \| slice:0:3 }}`                                                                                                                   |
| `keys`, `entries`                     | `@for ([k, v] of obj \| entries) { … }`                                                                                                      |
| `json`                                | `{{ data \| json }}`                                                                                                                         |
| `url`                                 | `href="/search?q={{ term \| url }}"`                                                                                                         |
| `raw`                                 | `{{ html \| raw }}`                                                                                                                          |

Dates and numbers use `locale` (default `en-US`) and `timeZone` (default `UTC`, never the server's zone). Set them in `createViews`, per request through `share`, or per call: `ctx.render(name, data, { locale: 'sw-KE', timeZone: 'Africa/Nairobi' })`.

### Your own pipes

Export them from `src/views/pipes.ts`:

```ts
import { safeHtml, withEnv } from '@forinda/kickjs-view'

export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')

export function stars(n: number) {
  return safeHtml('★'.repeat(n)) // trusted HTML, printed as is in text
}

export const ago = withEnv(
  ({ locale }) =>
    (date: Date) =>
      new Intl.RelativeTimeFormat(locale).format(
        Math.round((+date - Date.now()) / 86_400_000),
        'day',
      ),
)
```

Some rules, because the build and the editor read this file without running it:

- Export each pipe by name: `export const`, `export function`, or `export { a, b as c }`. `export *`, default exports and re-exports aren't allowed.
- A pipe can't reuse a built-in's name.
- Pipes are synchronous. Load data in the controller.

## Shared data

```ts
createViews({
  ...kickViews,
  share: (ctx) => ({
    user: ctx?.get('user'),
    cspNonce: ctx?.get('cspNonce'),
    csrfToken: ctx?.get('csrfToken'),
  }),
})
```

`share` runs for every `ctx.render`, inside the request, and its values sit under the page's own data. Set a CSP nonce and a CSRF token in middleware with `ctx.set`, then use them in the base layout:

```kick
<meta name="csrf-token" content="{{ csrfToken }}">
<script nonce="{{ cspNonce }}" src="/app.js"></script>
```

## Assets

`@assets('src/client/main.ts')` writes the tags for a Vite entry. Give `createViews` an `assets` function:

```ts
import { assetTags } from '@forinda/kickjs-view'
import manifest from '../dist/client/.vite/manifest.json' with { type: 'json' }

const mode = import.meta.env.DEV ? { dev: true, base: '/' } : { dev: false, manifest, base: '/' }

createViews({
  ...kickViews,
  assets: (entry, data) => assetTags(entry, mode, data.cspNonce as string),
})
```

In dev that's the Vite client plus the module. In a build it's the hashed script, its CSS and preload tags, each with the nonce when there is one.

## Partials and htmx

```ts
@Get('/users/rows')
async rows(ctx: RequestContext) {
  await ctx.render('users/rows', { users }, { layout: false })
}
```

`ctx.render` also takes `status` and `headers`: `{ status: 422, headers: { 'HX-Retarget': '#form' } }`.

## Emails, PDFs and tests

`views.render()` works outside a request:

```ts
const html = await views.render('emails/welcome', { name: user.name }, { layout: 'layouts/email' })
await mailer.send({ to: user.email, subject: 'Welcome', html })
```

## Error pages

```ts
bootstrap({
  modules,
  adapters: [KickView({ views })],
  onNotFound: async (req, res) => {
    res
      .status(404)
      .type('text/html; charset=utf-8')
      .send(await views.render('errors/404'))
  },
})
```

In dev a template error shows its file, line and column. In production the response is a plain 500, and the details go to the log.

## Mixing with EJS or Pug

With `KickView` and [`ViewAdapter`](./view-engines.md) both installed (Express), `ctx.render(name)` renders the `.kick` template when there is one. Otherwise the name goes to `ViewAdapter`.

## The edge

On Workers and Vercel Edge, `@forinda/kickjs-view` resolves to a build without file access: templates come from `virtual:kick-views`, checked when you build. Use `viewsMiddleware(views)` with the [web entry](./edge-deployment.md):

```ts
import kickViews from 'virtual:kick-views'
import { createViews, viewsMiddleware } from '@forinda/kickjs-view'

const views = createViews({ ...kickViews })
export default createWebApp({ h3, modules, middlewares: [viewsMiddleware(views)] })
```

## Formatting and checking

Add the plugin to `kick.config.ts`:

```ts
import { viewCliPlugin } from '@forinda/kickjs-view/cli'
export default defineConfig({ plugins: [viewCliPlugin] })
```

- `kick fmt:views` formats every template: `{{ x | pipe }}` and `@if (x) {` spacing, indentation by nesting, and a closing tag or `}` on its own line when its opener is on an earlier one. `<pre>`, `<textarea>`, `<script>`, `<style>`, `@verbatim` and comments are left exactly as written. A file is only rewritten if the result means the same template; otherwise it's left alone with a warning.
- `kick fmt:views --check` lists the files that would change and exits 1, which suits CI.
- `kick check:views` reports every error with its file, line and column, the same checks the build runs: syntax, unknown pipes, component inputs, slots, layouts and unsafe interpolation.

## Editor support

The KickJS VS Code extension understands `.kick` files:

- highlighting for `{{ }}`, `@if` / `@for` / `@switch`, bindings and comments, on top of HTML;
- errors as you type, from the same checks as `kick check:views`, including in unsaved files;
- completion for `@` keywords, pipes after `|`, components and their inputs, layout and slot names, and the names in scope inside `{{ }}`;
- HTML, CSS and Emmet completion inside templates;
- hover on a pipe or a component to see its parameters or inputs;
- go to definition on a component tag, `@layout('…')` or a pipe;
- find references to a component, layout or pipe across templates;
- rename a pipe (its uses and `pipes.ts`), a component (its tags and file) or a layout (its `@layout('…')` uses and file), and renaming a template file in the explorer updates its uses, including the `ctx.render('…')` calls that name it;
- Format Document, with the same output as `kick fmt:views`;
- template names inside `ctx.render('…')` in your controllers.

In a trusted workspace the editor uses your project's installed `@forinda/kickjs-view`, so it agrees with your build. If the project has none, it uses its bundled copy and says so once in the output panel.

Settings (relative to the workspace folder):

| setting                     | default          |                                                                   |
| --------------------------- | ---------------- | ----------------------------------------------------------------- |
| `kickjs.views.dir`          | `src/views`      |
| `kickjs.views.components`   | `components`     |
| `kickjs.views.pipes`        | `<dir>/pipes.ts` |
| `kickjs.views.layout`       | none             | as `createViews({ layout })`: one name, or folder prefix → layout |
| `kickjs.views.baseLayout`   | none             | as `createViews({ baseLayout })`                                  |
| `kickjs.views.trace.server` | `off`            |                                                                   |

If your `createViews` maps layouts by folder or sets a `baseLayout`, give the editor the same values in `kickjs.views.layout` and `kickjs.views.baseLayout`. The editor doesn't read your `createViews` call, so without them it can't tell which layout a page without `@layout` renders in, and warns that its `@slot` blocks have no layout to fill.

Other editors (Neovim, Vim, Helix, Emacs, JetBrains IDEs) can run the same language server directly: see [`.kick` in other editors](./view-editors.md).

## Options

| option            | default                                       |                                                                                              |
| ----------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `viewsDir`        | `'src/views'`                                 |                                                                                              |
| `componentsDir`   | `'components'`                                | inside `viewsDir`                                                                            |
| `pipesFile`       | `'src/views/pipes.ts'`                        | `.js` also works; without Vite, Node runs a `.ts` file only when it can strip types (22.18+) |
| `layout`          | none                                          | a layout name, or folder prefix → layout                                                     |
| `baseLayout`      | none                                          | the shell around every page's outermost layout                                               |
| `locale`          | `'en-US'`                                     |                                                                                              |
| `timeZone`        | `'UTC'`                                       |                                                                                              |
| `strict`          | `false`                                       | unknown names and values that can't print become errors                                      |
| `share`           | none                                          | `(ctx) => data`                                                                              |
| `assets`          | none                                          | `(entry, data) => tags`, for `@assets`                                                       |
| `cache`           | `true`                                        | `false` re-reads every template on every render                                              |
| `dev`             | `NODE_ENV !== 'production'` (with `KickView`) | re-check changed templates on each render                                                    |
| `bundle`, `pipes` | from `virtual:kick-views`                     |                                                                                              |
| `loader`          | the file loader                               | `{ list, read, version? }` for templates from anywhere else                                  |

## Related

- [View Engines](./view-engines.md) — EJS, Pug, Handlebars through `ViewAdapter`
- [Inertia](./inertia.md) — interactive pages with React, Vue or Svelte
- [Edge deployment](./edge-deployment.md)

::::
