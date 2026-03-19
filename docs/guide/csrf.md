# CSRF Protection

KickJS includes a double-submit cookie CSRF middleware that protects state-changing requests from cross-site request forgery attacks.

## How It Works

The `csrf()` middleware uses the **double-submit cookie** pattern:

1. On every request, a random token is set as a cookie (if not already present).
2. For state-changing methods (POST, PUT, PATCH, DELETE), the middleware checks that the value in the `x-csrf-token` request header matches the cookie value.
3. If the tokens do not match or the header is missing, the request is rejected with a **403** response.

## Setup

The CSRF middleware requires a cookie parser to be registered before it:

```ts
import cookieParser from 'cookie-parser'
import { csrf } from '@kickjs/http'

bootstrap({
  modules,
  middleware: [
    cookieParser(),
    csrf(),
  ],
})
```

## CsrfOptions

Pass an options object to customize behavior:

```ts
csrf({
  cookie: '_csrf',               // cookie name (default: '_csrf')
  header: 'x-csrf-token',       // header name to validate (default: 'x-csrf-token')
  methods: ['POST', 'PUT', 'PATCH', 'DELETE'],  // methods that require validation
  ignorePaths: ['/webhooks/stripe', '/webhooks/github'],
  tokenLength: 32,               // bytes before hex encoding (default: 32 = 64 hex chars)
  cookieOptions: {
    httpOnly: true,              // default: true
    sameSite: 'strict',          // default: 'strict'
    secure: true,                // default: true in production
    path: '/',                   // default: '/'
  },
})
```

| Option | Type | Default |
| --- | --- | --- |
| `cookie` | `string` | `'_csrf'` |
| `header` | `string` | `'x-csrf-token'` |
| `methods` | `string[]` | `['POST', 'PUT', 'PATCH', 'DELETE']` |
| `ignorePaths` | `string[]` | `[]` |
| `tokenLength` | `number` | `32` |
| `cookieOptions` | object | See above |

The `secure` cookie flag defaults to `true` when `NODE_ENV` is `'production'` and `false` otherwise.

## Client-Side Usage

Your frontend needs to read the CSRF cookie and send it back as a header on every mutating request.

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

with HTTP status **403**.
