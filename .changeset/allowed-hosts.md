---
'@forinda/kickjs': minor
---

New `allowedHosts()` middleware and a `bootstrap({ security: { allowedHosts } })` option. Requests for any host not listed get a 400 problem-details response, so a client-chosen `Host` can't end up in password-reset links, redirects or cached responses. `'.example.com'` matches the domain and its subdomains. `X-Forwarded-Host` is read only with `trustForwardedHost: true`, and then every value in it must be allowed. Without that option the header is removed from the request. The bootstrap option runs the check before anything else is mounted, and exempts `GET`/`HEAD` on `/health/live` and `/health/ready`, which orchestrators probe by IP.
