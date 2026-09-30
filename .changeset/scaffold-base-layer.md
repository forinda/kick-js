---
'@forinda/kickjs-cli': minor
---

`kick new` builds projects from template layers, and `--packages ws,queue` now produce working apps.

- **ws and queue are wired and complete.** Before, they were added to package.json but never wired into `src/index.ts`, and their peers were missing, so the app couldn't use them.
  - `ws` now adds `WsAdapter({ path: '/ws' })` and installs `ws`.
  - `queue` now adds `QueueAdapter` over Redis (`REDIS_HOST` / `REDIS_PORT`, written to `.env`) and installs `bullmq` and `ioredis`. Nothing connects until a job or queue is used, so the app boots without Redis.
- **pnpm 10+ installs no longer fail on bullmq.** `bullmq`'s `msgpackr-extract` install script is now answered (declined — msgpackr falls back to JS), which pnpm requires. This also fixes `kick add queue:bullmq`.
- **`--template fullstack` honours `--packages`.** The packages are wired into `server/`, with their install-script answers recorded at the workspace root. Before, the choice was dropped.
- **Unknown `--packages` names** are skipped with a warning instead of being ignored silently.
- **Generated files change shape slightly, not behaviour:**
  - `src/index.ts` merges its imports per module and always spells out `bootstrap({ ... })` over several lines.
  - The `rest` template notes why `express.json()` is there.
  - `package.json` dependencies are sorted by name.
  - `tsconfig.json` and `.oxfmtrc.json` end with a newline.
- **`--yes` with explicit flags** (`--runtime`, `--schema`, `--packages`, `--template`, `--pm`, `--repo`) keeps overriding the defaults as before.
- **Config warnings:** a fresh scaffold (or a global `kick` in a project whose dependencies aren't installed) no longer warns `Failed to load kick.config.ts: Cannot find module '@forinda/kickjs-cli'`. The config loader uses the running CLI when the project doesn't have the package.
