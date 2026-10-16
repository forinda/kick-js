---
'@forinda/kickjs-devtools': minor
---

`DevToolsAdapter` mounts `/_debug` by default only when `NODE_ENV` is `development` or `test`. It used to mount whenever `NODE_ENV` wasn't `production`, so a deploy that never set `NODE_ENV` served the dashboard.

**Migration:** an app that ran DevTools with `NODE_ENV` unset (or set to something like `staging`) no longer gets `/_debug`. Set `NODE_ENV=development`, or pass `DevToolsAdapter({ enabled: true })` where you want it on regardless.
