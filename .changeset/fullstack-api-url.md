---
'@forinda/kickjs-cli': patch
---

Fullstack scaffold: `web/src/api.ts` reads an optional `VITE_API_URL` in front of `/api/v1`, so the web app can be built against an API on another origin; it stays unset for the default single-origin setup. `web/tsconfig.json` adds `vite/client` to `types` for `import.meta.env`. The generated agent docs describe the current type loop — the ambient `KickClientApi` map from `kick__client.d.ts`, refreshed by `kick typegen` (not by `kick dev`) — and the next-steps message says to run `kick typegen` after changing a response.
