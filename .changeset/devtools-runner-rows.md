---
'@forinda/kickjs-devtools': minor
---

API runner and Routes tab:

- Key/value rows can be removed (✕), reordered by dragging, marked secret (masked until revealed), and expanded to read or edit a long value such as a JWT.
- Under a route's _Headers_, each environment default header has its own tick for that route — a login route without the global `Authorization`. A public route flag only sets the starting tick for `Authorization`; ticking it sends it.
- **Save to variable** belongs to the route it's set on, and reruns on every 2xx response from it. A saved variable starts out secret.
- Controller groups in the Routes list collapse (remembered), with **Collapse all**; a search shows every match.
- The public route flags setting explains what it does.
- Fix: opening a route could save the previous route's inputs under the new route (a never-opened route inherited its body and Save to variable), depending on the order the runner's effects ran in.
- Hover the request body for **Format** (pretty-print JSON) and **Copy**, and the response body for **Copy** (the whole body, formatted).
