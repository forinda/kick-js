# Inertia

::: warning Experimental
`@forinda/kickjs-inertia` is experimental. The API may change in future releases. Use in production at your own discretion.
:::

[Inertia.js](https://inertiajs.com) is a protocol for building server-driven SPAs without a separate API. Controllers return page component names and props; the client-side adapter renders the matching React, Vue, or Svelte component. No REST endpoints, no fetch boilerplate — the server stays in control.

`@forinda/kickjs-inertia` implements the Inertia protocol as an `AppAdapter`. It adds `ctx.inertia` to every `RequestContext` via module augmentation and handles the full request lifecycle: first-visit HTML, subsequent JSON responses, version mismatch redirects, and optional SSR.

## Installation

::: code-group
```bash [kick add]
kick add inertia
```
```bash [pnpm]
pnpm add @forinda/kickjs-inertia
```
:::

## Setup

Register the adapter in `bootstrap()` using `defineInertiaConfig`:

```ts
import { bootstrap } from '@forinda/kickjs'
import { InertiaAdapter, defineInertiaConfig } from '@forinda/kickjs-inertia'
import { readFileSync } from 'node:fs'

const config = defineInertiaConfig({
  rootView: readFileSync('src/views/app.html', 'utf-8'),
})

bootstrap({
  modules: [...],
  adapters: [new InertiaAdapter(config)],
})
```

`defineInertiaConfig` fills in defaults: `version` is auto-derived from the Vite manifest MD5 hash, `ssr.enabled` defaults to `false`, and `share` defaults to returning `{}`.

### Config Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rootView` | `string \| RootViewFunction` | *required* | HTML template string or a function that returns one |
| `version` | `() => string` | MD5 of Vite manifest | Asset version sent to clients |
| `ssr` | `SsrConfig` | `{ enabled: false }` | SSR options (see [SSR](#ssr)) |
| `share` | `(ctx) => Record<string, any>` | `() => ({})` | Shared props injected into every page |

## Controller Usage

`ctx.inertia` is available on every `RequestContext` after the adapter is registered:

```ts
import { Controller, Get, Service, Autowired } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { UserService } from '../user/user.service'

@Controller('/dashboard')
export class DashboardController {
  @Autowired()
  private userService!: UserService

  @Get('/')
  async index(ctx: RequestContext) {
    const user = await this.userService.findById(ctx.session.userId)
    return ctx.inertia.render('Dashboard/Index', { user })
  }

  @Get('/settings')
  async settings(ctx: RequestContext) {
    return ctx.inertia.render('Dashboard/Settings', {
      profile: await this.userService.getProfile(ctx.session.userId),
    })
  }
}
```

The first argument to `render` is the component name — it must match the component path your client adapter is configured to resolve (e.g. `Dashboard/Index` → `src/pages/Dashboard/Index.tsx`).

### Inertia Redirects

After a mutation (PUT, PATCH, DELETE), redirect with the correct status using `ctx.inertia.redirect()`. It automatically upgrades 302 to 303 for those methods so the browser follows with a GET:

```ts
@Post('/logout')
async logout(ctx: RequestContext) {
  await this.authService.logout(ctx.session)
  ctx.inertia.redirect('/')
}
```

## Prop Helpers

Import helpers to control when and how props are evaluated.

```ts
import { defer, optional, always, merge } from '@forinda/kickjs-inertia'
```

### `defer(fn, group?)`

The prop is excluded from the first page load and fetched in a follow-up request. Use for expensive data that is not needed for the initial render:

```ts
return ctx.inertia.render('Reports/Show', {
  summary: report.summary,
  chartData: defer(() => this.reportService.buildChart(report.id)),
  activityLog: defer(() => this.reportService.activityLog(report.id), 'secondary'),
})
```

Props in the same group are fetched together.

### `optional(fn)`

The prop is resolved only when explicitly requested in a partial reload. It is skipped entirely on full page loads:

```ts
return ctx.inertia.render('Users/Index', {
  users,
  exportUrl: optional(() => this.exportService.signedUrl()),
})
```

### `always(value)`

The prop is included on every request, including partial reloads that do not request it by name. Use for data that must always be current (e.g. notification counts):

```ts
return ctx.inertia.render('App/Shell', {
  page: mainContent,
  unreadCount: always(await this.notificationService.unreadCount(ctx.session.userId)),
})
```

### `merge(value)`

The prop value is merged into the existing client-side prop rather than replacing it. Useful for paginated lists that append results:

```ts
return ctx.inertia.render('Posts/Index', {
  posts: merge(page.items),
  nextCursor: page.nextCursor,
})
```

## Shared Data

Use `config.share` to inject props into every page response. Common uses: authenticated user, flash messages, CSRF token.

```ts
const config = defineInertiaConfig({
  rootView: readFileSync('src/views/app.html', 'utf-8'),
  share: async (ctx) => ({
    auth: {
      user: ctx.session?.userId
        ? await userService.findById(ctx.session.userId)
        : null,
    },
    flash: {
      success: ctx.session?.flash?.success ?? null,
      error: ctx.session?.flash?.error ?? null,
    },
  }),
})
```

Shared props are merged with page-level props before the response is sent. Page-level props take precedence when keys conflict.

## The Protocol

Understanding the protocol helps with debugging and custom integrations.

### First Visit (Full HTML)

A browser navigates to `/dashboard`. No `X-Inertia` header is present. The server:

1. Evaluates all props (skipping deferred and optional)
2. Serialises the page object into `globalThis.__INERTIA_PAGE__`
3. Injects it into the HTML template and sends a full `200` response

### Subsequent Visits (JSON)

The client sends `X-Inertia: true` on every subsequent navigation. The server:

1. Returns `Content-Type: application/json` with the page object
2. Sets `X-Inertia: true` and `Vary: X-Inertia` response headers

### Version Mismatch (409)

When the client's `X-Inertia-Version` header does not match the server's current version, the server returns `409 Conflict`. The client then forces a full browser reload to pick up the new assets.

### Mutation Redirects (303)

For PUT, PATCH, and DELETE requests followed by a redirect, `ctx.inertia.redirect()` sends `303 See Other`. This ensures the browser follows with a GET, preventing form re-submission on back-navigation.

## HTML Template

Create `src/views/app.html`. The adapter replaces four comment placeholders at render time:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
    <!-- {{HEAD}} -->
    <!-- {{VITE_SCRIPTS}} -->
  </head>
  <body>
    <div id="app"><!-- {{SSR_CONTENT}} --></div>
    <!-- {{INERTIA_PAGE}} -->
  </body>
</html>
```

| Placeholder | Replaced with |
|-------------|---------------|
| `<!-- {{HEAD}} -->` | SSR-generated `<head>` tags (empty when SSR is off) |
| `<!-- {{SSR_CONTENT}} -->` | SSR-rendered HTML body (empty when SSR is off) |
| `<!-- {{INERTIA_PAGE}} -->` | `<script>` tag that sets `globalThis.__INERTIA_PAGE__` |
| `<!-- {{VITE_SCRIPTS}} -->` | `<script type="module">` entry point (dev) or hashed bundle tags (prod) |

In production the adapter reads `build/client/.vite/manifest.json` or `dist/client/.vite/manifest.json` to resolve hashed asset filenames and inject the correct `<link>` and `<script>` tags automatically.

### Custom Template Function

If you need full control over the HTML shell, pass a function instead of a string:

```ts
import type { RootViewFunction } from '@forinda/kickjs-inertia'

const rootView: RootViewFunction = (page, { head, body }) => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${head}
  </head>
  <body>
    <div id="app">${body}</div>
    <script>globalThis.__INERTIA_PAGE__ = ${JSON.stringify(page)}</script>
  </body>
</html>
`

const config = defineInertiaConfig({ rootView })
```

## SSR

Server-side rendering is optional. Enable it in the config and point `entrypoint` at your SSR bundle:

```ts
const config = defineInertiaConfig({
  rootView: readFileSync('src/views/app.html', 'utf-8'),
  ssr: {
    enabled: true,
    entrypoint: 'src/ssr.tsx',   // source path (resolved via Vite manifest in prod)
    bundle: 'dist/ssr/index.mjs', // optional: explicit path to the built SSR bundle
  },
})
```

When SSR is enabled, `render()` loads `ServerRenderer`, calls the SSR bundle with the page object, and injects the resulting `head` and `body` into the template. If the SSR bundle throws or is unreachable, the adapter silently falls back to client-side rendering — the page still works, just without the SSR HTML.

The SSR bundle is loaded from `bundle` if provided, otherwise from the Vite manifest entry for `entrypoint`.

## Client Setup

Install the Inertia client adapter for your frontend framework:

::: code-group
```bash [React]
pnpm add @inertiajs/react
```
```bash [Vue]
pnpm add @inertiajs/vue3
```
```bash [Svelte]
pnpm add @inertiajs/svelte
```
:::

Then initialise Inertia in your client entry point. See the official documentation for each adapter:

- [React — inertiajs.com/client-side-setup](https://inertiajs.com/client-side-setup)
- [Vue — inertiajs.com/client-side-setup](https://inertiajs.com/client-side-setup)
- [Svelte — inertiajs.com/client-side-setup](https://inertiajs.com/client-side-setup)

## Related

- [Adapters](./adapters.md) — adapter lifecycle and `AppAdapter` interface
- [SPA Integration](./spa.md) — serving a fully client-side SPA from KickJS
- [Controllers & Routes](./controllers.md) — controller decorators and `RequestContext`
- [Sessions](./sessions.md) — cookie sessions for flash messages and auth state
