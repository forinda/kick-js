---
'@forinda/kickjs-devtools': minor
---

Routes and the API runner:

- **Routes list:** each route shows one compact pill (`2 flags · ctx 1`) instead of the flag values, so paths stay readable. Search also matches flag names (`auth.public`) and contributor keys.
- **API runner:** now tabbed — **Request** (params, query, headers, body, save to variable), **Meta** (the route's flags and context contributors), **Snippet**, **History** and **Settings**. The response stays below whichever tab is open.
- **Flag values in Meta:** an object reads as key/value rows, and a list (a long `permissions` list, say) as chips that fold after eight.
