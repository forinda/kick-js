---
'@forinda/kickjs': minor
---

`ctx.render(name, data, opts)` uses a view engine bound to the request (`KickView` from `@forinda/kickjs-view`) on every runtime, and falls back to `ViewAdapter` on Express.

- With a bound engine it returns a promise; `opts` takes `status`, `headers`, `layout` (a name, or `false` for none) and `locale` / `timeZone`.
- A render the handler doesn't await is still waited for, and its errors reach the error handler.
- New exports `bindViewRenderer`, `viewRendererFor`, `VIEW_RENDERER` and `ViewRenderer` let other engines plug in.
