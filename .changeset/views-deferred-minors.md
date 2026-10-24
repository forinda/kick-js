---
'@forinda/kickjs-view': patch
'@forinda/kickjs-vite': patch
'@forinda/kickjs-cli': patch
---

Views fixes:

- A built `validators.ts` that imports CSS gets its stylesheet linked on pages with a `validate` field.
- From source, a `validators.js` is served as written instead of going through the TypeScript stripper, and an async `stripTypes` option is awaited before the validators register themselves.
- `vite build --watch` rebuilds when `validators.ts` is added, and when a file a client script or `validators.ts` imports changes.
- `kick add views` skips the `kick.config.ts` hint when `viewCliPlugin` is already there, and its `home` page reads "Hello from KickJS" when rendered with no data. The views forms skill covers `validators.ts`.
