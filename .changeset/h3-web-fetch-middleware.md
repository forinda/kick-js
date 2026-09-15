---
'@forinda/kickjs': patch
---

fix(h3-web): an `Application` on `h3WebRuntime()` called through `app.getRuntimeApp().fetch(request)` answered every request with 500 (`[h3] Executing Node.js middleware is not supported in this server!`)

Every connect middleware the Application mounts — request tracking, request scope, helmet, request id, plus plugin, adapter and user middleware — went through h3's `fromNodeHandler`, which throws when the event has no node response. On the fetch path those middleware now run against a web-backed `req` / `res` (headers, `statusCode`, `end`, `next(err)`, `finish` / `close`), and their headers are merged into the final response for every status. Behind a node server nothing changes: `fromNodeHandler` still runs them with the real node objects.

A fetch-only app also got h3's bare 404 instead of kick's 404 / 405, because the catch-all route was assembled only in `nodeHandler()`. It is now assembled when the not-found handler is set.
