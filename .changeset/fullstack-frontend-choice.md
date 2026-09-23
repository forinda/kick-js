---
'@forinda/kickjs-cli': minor
---

`kick new --template fullstack` now asks who scaffolds `web/`: the wired KickJS React app (default), or `create-vite`. Choosing create-vite hands the directory over — you pick the framework at its own prompts — and KickJS patches nothing afterwards; the scaffold prints the [Wiring your own frontend](https://kickjs.app/guide/fullstack-frontend.html) guide, which covers the four steps (typed client, `/api` dev proxy, route-map types, `src/api.ts`).

The framework is chosen in `kick new`, not by create-vite's own prompts: the CLI passes `--template`, `--no-interactive` and `--no-immediate`, so the scaffold never waits for input and never starts a dev server. Only TypeScript templates are offered (react-ts, react-compiler-ts, vue-ts, svelte-ts, solid-ts, preact-ts, lit-ts, qwik-ts, vanilla-ts) — the wiring is typed, so a JavaScript template could not follow the guide.

`--frontend kick|vite` and `--vite-template <name>` answer both questions for a scripted run, including with `--yes`.
