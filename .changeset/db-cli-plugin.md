---
'@forinda/kickjs-db': minor
'@forinda/kickjs-cli': minor
---

Ship the database CLI from `@forinda/kickjs-db/cli` — a mountable plugin **and** a standalone `kickjs-db` bin — so you can use the db tooling without (or alongside) `@forinda/kickjs-cli`.

**New: `@forinda/kickjs-db/cli`**

- `dbCliPlugin` — a CLI plugin (`@forinda/kickjs-cli-kit` contract). Mount it in `kick.config.ts` to get `kick db generate | migrate latest|up|down|rollback|status|review | introspect`. It reads config from the same `kick.config.ts` `db` block (via `ctx.config`, no re-parse).
- `defineKickDbConfig` / `mergeKickDbConfig` / `resolveKickDbConfig` — vite-style config helpers. Author a standalone `kickjs-db.config.ts` (`export default defineKickDbConfig({ ... })`) or reuse the `kick.config.ts` `db` block; the two merge (later wins).
- Standalone **`kickjs-db` bin** — `npx kickjs-db migrate latest` runs the whole command tree without kickjs-cli, loading `kickjs-db.config.ts` (or a `kick.config.ts` `db` block) through jiti.

**Breaking (`@forinda/kickjs-cli`): `kick db` is now opt-in.**
The `kick db` commands are no longer built into kickjs-cli. Add the plugin to your config:

```ts
import { defineConfig } from '@forinda/kickjs-cli'
import { dbCliPlugin } from '@forinda/kickjs-db/cli'

export default defineConfig({ plugins: [dbCliPlugin] })
```

Zero-config **db type generation is unchanged** — it stays a built-in typegen (`kick typegen` still emits `.kickjs/types` for your schema). Only the `kick db` _commands_ moved.
