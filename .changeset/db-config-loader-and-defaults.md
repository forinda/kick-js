---
'@forinda/kickjs-cli': patch
'@forinda/kickjs-db': patch
---

Fix `kick db` with plugin-importing configs, and non-string column defaults.

- **`kick db` commands now load `kick.config.ts` through the CLI's jiti loader** (`loadKickConfig`) instead of `@forinda/kickjs-db`'s native `import()`. Native ESM can't resolve the extensionless, relative TypeScript imports a config commonly uses — e.g. `import { toolsPlugin } from './tools/cli-plugin'` to mount a CLI plugin — so every `kick db ...` command failed with `Cannot find module` whenever the config imported local TS. It now resolves exactly like the rest of the CLI.

- **Column `.default()` accepts `string | number | boolean`** and normalises non-strings to their SQL-literal text. `boolean().default(false)` / `integer().default(0)` previously stored a raw boolean/number in the snapshot, which crashed migration emit with `value.replace is not a function`. The Postgres emitter (`formatDefault`) is also hardened to coerce booleans/numbers defensively, so a pre-existing snapshot with a non-string default emits a bare SQL literal (`false`, `0`) instead of throwing.
