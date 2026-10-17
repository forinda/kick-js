---
'@forinda/kickjs-vite': patch
---

A build that keeps DevTools — `kickjsVitePlugin({ devtools: { enabled: true } })` or `KICKJS_DEVTOOLS=1` — keeps your `@forinda/kickjs-devtools-kit` imports and custom tabs too. They were stripped from every `vite build`, so the dashboard shipped without them.
