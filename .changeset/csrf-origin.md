---
'@forinda/kickjs': minor
---

`csrf()` and `csrfGuard()` check where a state-changing request came from before the token. `Sec-Fetch-Site: same-origin` passes. Otherwise `Origin` (or `Referer`) must match the request's `Host` or a new `trustedOrigins` entry, and a browser request that says it is cross-site without an origin is refused (403 `CSRF origin not allowed`). Requests without these headers (servers, curl) still rely on the token.

A frontend on another origin (for example `app.example.com` calling `api.example.com`) must now be listed in `trustedOrigins`. `checkOrigin: false` turns the check off.
