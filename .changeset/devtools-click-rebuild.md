---
'@forinda/kickjs-devtools': patch
---

Clicking a route on the Routes tab opens its runner every time. In a busy app, every DI resolve made the dashboard refetch all its data and rebuild the route list, sometimes many times a second, so a click could land on a row that was being replaced. The dashboard now refetches at most once a second after container changes, and keeps the list as it is when the routes haven't changed.
