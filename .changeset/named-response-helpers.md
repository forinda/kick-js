---
'@forinda/kickjs-cli': patch
---

The generated agent docs (`kick g agents`, `kick new`) now name every
runtime-neutral response helper where they say "write responses with `ctx.*`,
never `ctx.res`". The rule listed only `ctx.problem` and `ctx.json`, so someone
returning a generated file reached for `ctx.res.setHeader()` + `ctx.res.end()` —
Express-only — without finding `ctx.download()` (#672). It now also names
`ctx.download`, `ctx.html`, `ctx.redirect` and `ctx.sse`.
