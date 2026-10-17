---
'@forinda/kickjs-devtools': minor
---

The Routes tab lists everything the app serves: routes adapters add (`/metrics`, a webhook) under the adapter's name, and routes on the management port with a `mgmt` badge. `/_debug/routes` gives each route `source` (`'module'` or `'adapter'`) and `port` (`'app'` or `'management'`), and says which port the dashboard is on; the API runner sends only to routes on that one.
