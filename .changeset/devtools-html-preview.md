---
'@forinda/kickjs-devtools': minor
---

API runner: an HTML response (`text/html`) shows a rendered preview, with a Raw / Preview toggle. The page renders in a sandboxed iframe — its scripts don't run, and it can't reach DevTools or the app's cookies — and its relative CSS and images load from the URL it came from.
