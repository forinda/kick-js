---
'@forinda/kickjs': patch
---

`rateLimit({ exemptWhen })` mounted at a path (`{ path: '/api', handler: rateLimit(...) }`) now finds the route by its full URL, so flagged routes under the mount are exempt on every engine. Before, it looked the route up by the mount-relative path, matched nothing, and limited them.
