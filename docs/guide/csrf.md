# CSRF Protection

KickJS includes a double-submit cookie CSRF middleware that protects state-changing requests from cross-site request forgery attacks.

## How It Works

The `csrf()` middleware checks two things on state-changing methods (POST, PUT, PATCH, DELETE):

1. **Where the request came from.** Browsers say so themselves. `Sec-Fetch-Site: same-origin` passes. Otherwise the `Origin` header (or the `Referer`'s origin) must match the request's `Host`, or one of `trustedOrigins`. A browser request that says it is cross-site without an origin is refused. Requests with none of these headers (servers, curl) go on to the token check.
2. **The token (double-submit cookie).** On every request a random token is set as a cookie if not already present, and the `x-csrf-token` header must match it.

Either check failing answers **403**. The origin check is what the token alone can't do: a sibling subdomain that can set cookies on your parent domain can plant a token, but it can't make the browser send your origin.

## Setup

The CSRF middleware requires a cookie parser to be registered before it:

```ts
import cookieParser from 'cookie-parser'
import { csrf } from '@forinda/kickjs'

bootstrap({
  modules,
  middlewares: [cookieParser(), csrf()],
})
```

## CsrfOptions

Pass an options object to customize behavior:

```ts
csrf({
  cookie: '_csrf', // cookie name (default: '_csrf')
  header: 'x-csrf-token', // header name to validate (default: 'x-csrf-token')
  field: '_csrf', // form field checked when the header is absent (default: '_csrf')
  methods: ['POST', 'PUT', 'PATCH', 'DELETE'], // methods that require validation
  ignorePaths: ['/webhooks/stripe', '/webhooks/github'],
  tokenLength: 32, // bytes before hex encoding (default: 32 = 64 hex chars)
  trustedOrigins: ['https://app.example.com'], // other origins allowed to send requests
  checkOrigin: true, // default: true
  cookieOptions: {
    httpOnly: false, // default: false — the page must be able to read the token
    sameSite: 'strict', // default: 'strict'
    secure: true, // default: true in production
    path: '/', // default: '/'
  },
})
```

::: tip Why `httpOnly` defaults to `false` here
Double-submit CSRF requires the **client** to read the token cookie and echo it in a header. Under
`httpOnly: true`, `document.cookie` returns nothing, no header is sent, and every mutating request
answers `403` — the flow below could not work.

The token is not a credential: it is compared against the cookie the browser already sends, so a
token an attacker cannot read is also one your own page cannot send.

Set `httpOnly: true` only when the client receives the token another way — rendered into the page
by the server, or fetched from an endpoint of your own.
:::

| Option           | Type       | Default                              |
| ---------------- | ---------- | ------------------------------------ |
| `cookie`         | `string`   | `'_csrf'`                            |
| `header`         | `string`   | `'x-csrf-token'`                     |
| `field`          | `string`   | `'_csrf'`                            |
| `methods`        | `string[]` | `['POST', 'PUT', 'PATCH', 'DELETE']` |
| `ignorePaths`    | `string[]` | `[]`                                 |
| `tokenLength`    | `number`   | `32`                                 |
| `trustedOrigins` | `string[]` | `[]`                                 |
| `checkOrigin`    | `boolean`  | `true`                               |
| `cookieOptions`  | object     | See above                            |

The `secure` cookie flag defaults to `false` only when `NODE_ENV` is `'development'` or `'test'`, and `true` otherwise — an unset `NODE_ENV` counts as production.

### Frontend on another origin

When the page and the API are on different hosts — `app.example.com` calling `api.example.com` — list the page's origin, scheme included:

```ts
csrf({ trustedOrigins: ['https://app.example.com'] })
```

Behind a proxy that rewrites the `Host` header, list your public origin the same way. Turn the check off with `checkOrigin: false` only when you can't list the origins.

## Client-Side Usage

Your frontend needs to read the CSRF cookie and send it back as a header on every mutating
request. The default cookie is readable by JavaScript for exactly this reason.

### JavaScript / Fetch

```js
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? match[2] : null
}

fetch('/api/tasks', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-csrf-token': getCookie('_csrf'),
  },
  body: JSON.stringify({ title: 'New task' }),
})
```

### HTML forms

A plain form post can't set a header, so the token can also come as a form field, `_csrf` by default (`field` to rename it). Put it in each form with `csrfToken(ctx)`, which returns this request's token, including on the first visit, before the browser has the cookie:

```ts
import { csrfToken } from '@forinda/kickjs'

// With views, once for every page:
createViews({ ...kickViews, share: (ctx) => ({ csrfToken: csrfToken(ctx) }) })
```

```kick
<form method="post" action="/tasks">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}">
  …
</form>
```

The field is read from the parsed body. `csrfGuard()` runs inside the route, after the body is parsed. `csrf()` runs where you list it: on Express, put the body parsers ahead of it (`middlewares: [express.urlencoded({ extended: false }), csrf()]`). The header still wins when both are sent.

### Axios Interceptor

```js
import axios from 'axios'

axios.interceptors.request.use((config) => {
  const match = document.cookie.match(/(^| )_csrf=([^;]+)/)
  if (match) config.headers['x-csrf-token'] = match[2]
  return config
})
```

## Excluding Webhook Paths

Incoming webhooks from third-party services (Stripe, GitHub, etc.) cannot send your CSRF token. Exclude them with `ignorePaths`:

```ts
csrf({
  ignorePaths: ['/webhooks/stripe', '/webhooks/github'],
})
```

Path matching is exact -- `/webhooks/stripe` will not match `/webhooks/stripe/events`. If you need prefix matching, consider adding each specific path or using a separate router that does not include the CSRF middleware.

## Error Response

When validation fails, the middleware returns:

```json
{ "message": "CSRF token mismatch" }
```

or, when the origin check fails, `{ "message": "CSRF origin not allowed" }` — both with HTTP status **403**.

## Exempting routes by flag

`csrf()` takes `ignorePaths` — an exact pathname — which cannot express
`/webhooks/:provider` and keeps parsing after an `apiPrefix` or `version` change
that silently voids it.

Running before route matching is **not** the reason it has no flag option: the
connect-style `rateLimit()` runs there too and takes `exemptWhen`, reading a
policy table built at boot. CSRF has no equivalent because the check itself is
meaningless off a matched route — a token mismatch on a path that routes nowhere
is a 404, not a 403 — so exempting one was never the useful half. The flag-aware
path is the guard below.

`csrfGuard()` is the ctx-style counterpart. It runs inside the matched route, so
it reads [route flags](./route-flags.md) and works on every runtime including the
web entry:

```ts
import { csrfGuard, defineRouteFlag, Middleware } from '@forinda/kickjs'

const CsrfExempt = defineRouteFlag('csrf.exempt')

@Middleware(csrfGuard({ exemptWhen: 'csrf.exempt' }))
@Controller()
export class WebhooksController {
  @CsrfExempt
  @Post('/:provider') // exempt, params and all
  receive(ctx: RequestContext) {}

  @Post('/settings') // still protected
  settings(ctx: RequestContext) {}
}
```

`exemptWhen` takes a flag name, a list of names (matched any-of), or a predicate
`({ flags, route }) => boolean`.

Keep `csrf()` when you want one app-wide middleware that also covers requests
matching no route — there is nothing to exempt there, and nothing to read.
