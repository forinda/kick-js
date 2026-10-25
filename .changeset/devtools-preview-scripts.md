---
'@forinda/kickjs-devtools': patch
---

The API runner's HTML preview runs the page's scripts, so pages that render with JavaScript — Swagger UI, ReDoc, an SPA — no longer show blank. They run in an isolated frame that can't reach the dashboard, its token or your app's cookies; a page that fetches data from your API may still fail there on CORS.
