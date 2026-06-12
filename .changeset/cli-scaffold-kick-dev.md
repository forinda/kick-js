---
'@forinda/kickjs-cli': patch
---

Scaffolded projects now get `"dev": "kick dev"` instead of bare `"dev": "vite"`. The typegen-on-save watcher (and the opt-in `--typecheck` worker) live only in `kick dev` — the bare `vite` script gave working HMR with silently frozen `.kickjs/types`, so adding a route or controller required a manual `kick typegen` to refresh its typing. Existing projects: change the `dev` script in package.json to `kick dev`.
