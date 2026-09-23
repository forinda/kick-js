---
'@forinda/kickjs-cli': minor
---

`kick new --template fullstack` now asks who scaffolds `web/`: the wired KickJS React app (default), or `create-vite`. Choosing create-vite hands the directory over — you pick the framework at its own prompts — and KickJS patches nothing afterwards; the scaffold prints the [Wiring your own frontend](https://kickjs.app/guide/fullstack-frontend.html) guide, which covers the four steps (typed client, `/api` dev proxy, route-map types, `src/api.ts`).

The question is interactive only, so `--yes` always takes the wired template and stays offline-safe. `--frontend kick|vite` answers it for a scripted run.
