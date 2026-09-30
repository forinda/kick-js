---
'@forinda/kickjs-queue': minor
---

`QueueAdapter` no longer serves its DevTools panel routes in production.

`/_kick/queue/panel` and `/_kick/queue/data` have no auth and list every queue with its job counts. Before, they were mounted in every environment. They now follow DevTools' own default: on unless `NODE_ENV` is `production`, and the "Queue" DevTools tab is hidden when they're off. Pass the new `panel` option (`true` / `false`) to decide explicitly.
