---
'@forinda/kickjs': minor
---

New `allowedHosts()` middleware and a `bootstrap({ security: { allowedHosts } })` option. Requests for any host not listed get a 400 problem-details response, so a client-chosen `Host` can't end up in password-reset links, redirects or cached responses. `'.example.com'` matches the domain and its subdomains. `X-Forwarded-Host` is read only with `trustForwardedHost: true`, and only its last value (the nearest proxy's). The bootstrap option runs the check before anything else is mounted, and exempts `GET`/`HEAD` on `/health/live` and `/health/ready`, which orchestrators probe by IP.
