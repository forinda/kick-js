---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

`app.status` is the application's lifecycle as a reactive value: `'idle'`, `'starting'` while `start()` runs, `'ready'` once it serves, `'draining'` from `shutdown()`, then `'stopped'`. Read `app.status.value`, or `watch(app.status, fn)` to act on a change — deregister from service discovery when the app starts draining, say. `isDraining` and the readiness probe follow it. DevTools reports it in `/_debug/health` (`app`) and sends each change to the dashboard as an `app:status` event; its adapter statuses are reactive too.
