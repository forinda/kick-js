# Security Headers (Helmet)

The `helmet()` middleware sets security-related HTTP headers with sensible defaults for API servers. Zero external dependencies.

## Usage

```ts
import { helmet } from '@forinda/kickjs'

bootstrap({
  middleware: [helmet(), requestId(), express.json()],
})
```

## Default Headers

| Header | Default Value | Purpose |
|--------|--------------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-XSS-Protection` | `0` | Disables legacy XSS auditor (causes more harm than good) |
| `Referrer-Policy` | `no-referrer` | Controls referrer information |
| `X-DNS-Prefetch-Control` | `off` | Disables DNS prefetching |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS |
| `X-Powered-By` | *(removed)* | Hides server technology |

## Options

```ts
helmet({
  // Disable individual headers
  frameguard: false,
  hsts: false,
  referrerPolicy: false,

  // Change values
  frameguard: 'SAMEORIGIN',
  referrerPolicy: 'strict-origin-when-cross-origin',

  // HSTS with preload
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },

  // Content Security Policy
  contentSecurityPolicy: {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://cdn.example.com'],
    'style-src': ["'self'", "'unsafe-inline'"],
  },
})
```

## Sub-path Import

```ts
import { helmet } from '@forinda/kickjs/middleware/helmet'
```

# CORS

The `cors()` middleware handles Cross-Origin Resource Sharing with correct spec behavior.

## Usage

```ts
import { cors } from '@forinda/kickjs'

// Allow all origins (default)
bootstrap({
  middleware: [cors(), helmet(), express.json()],
})

// Allowlist specific origins
bootstrap({
  middleware: [
    cors({
      origin: ['https://app.example.com', /\.example\.com$/],
      credentials: true,
    }),
    helmet(),
    express.json(),
  ],
})
```

## Options

```ts
interface CorsOptions {
  origin?: boolean | string | RegExp | (string | RegExp)[]
  methods?: string[]            // default: GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: string[]     // default: reflects request headers
  exposedHeaders?: string[]     // default: none
  credentials?: boolean         // default: false
  maxAge?: number               // default: 86400 (24h)
  preflight?: boolean           // default: true
}
```

## Origin Matching

| Value | Behavior |
|-------|----------|
| `'*'` | Allow all origins (default) |
| `true` | Reflect the request's `Origin` header |
| `'https://app.example.com'` | Exact match |
| `/\.example\.com$/` | Regex match |
| `['https://a.com', /\.b\.com$/]` | Array of string/regex |

When reflecting origins (not `'*'`), the middleware sets `Vary: Origin` for correct CDN/proxy caching.

## Credentials

When `credentials: true`, the browser sends cookies and authorization headers cross-origin. This requires a specific origin (not `'*'`):

```ts
cors({
  origin: ['https://app.example.com'],
  credentials: true,
})
```

## Preflight

`OPTIONS` requests are handled with `204 No Content`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, and `Access-Control-Max-Age`.

## Sub-path Import

```ts
import { cors } from '@forinda/kickjs/middleware/cors'
```
