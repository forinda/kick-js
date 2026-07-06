---
'@forinda/kickjs-cli': minor
'@forinda/kickjs-client': patch
---

feat: `kick new --template fullstack` — typed end-to-end workspace

Scaffolds a pnpm workspace with `server/` (KickJS API) and `web/` (Vite +
React) where the frontend is typed against the backend via
`@forinda/kickjs-client` and the server's generated `KickRoutes.Api`:

```bash
kick new my-app --template fullstack
cd my-app && pnpm dev   # server (kick dev) + web (vite), proxied
```

Rename a field in a server handler → the web app stops compiling.

Also, found by proving the template end-to-end:

- `@forinda/kickjs-client`: package exports pointed at `dist/index.mjs` /
  `.d.mts` but the build emits `index.js` / `.d.ts` — the published entry was
  unresolvable; fixed
- `@forinda/kickjs-client`: the generated `KickRoutes.Api` is an interface
  (no index signature) and failed the client's `Record` constraint — the
  generic now accepts it
- the scaffolded hello controller uses return-value handlers, so its response
  types flow into the typed client out of the box
