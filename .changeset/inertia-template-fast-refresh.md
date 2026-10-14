---
'@forinda/kickjs-cli': patch
---

`kick new --template inertia`: page edits under `kick dev` now keep component state (React Fast Refresh). The template compiles `src/client` with Vite's oxc and the server with swc.

Apps scaffolded with 8.8.0 can copy the `oxc` and `swc.vite()` lines from the Inertia guide's "The dev server" section into their `vite.config.ts`.
