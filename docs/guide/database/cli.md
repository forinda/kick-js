# Database CLI

The `kick db` command tree (migrations, schema generation, introspection)
ships from **`@forinda/kickjs-db/cli`**. Use it two ways: mounted as a
plugin inside the `kick` CLI, or as the standalone `kickjs-db` binary —
no `@forinda/kickjs-cli` required.

## Commands

| Command               | Does                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `generate <name>`     | Diff the schema against the last snapshot, emit `up.sql` / `down.sql`. `-e/--empty` for a hand-authored shell. |
| `migrate latest`      | Apply all pending migrations in one batch.                                                                     |
| `migrate up` / `down` | Apply / reverse a single migration.                                                                            |
| `migrate rollback`    | Reverse the entire last batch.                                                                                 |
| `migrate status`      | Print applied + pending migrations.                                                                            |
| `migrate review <id>` | Mark a migration reviewed (flips `meta.json` only — the SQL banner is immutable, so the hash stays valid).     |
| `introspect`          | Generate a TypeScript schema file from a live database.                                                        |

## Option A — as a `kick` CLI plugin

Mount `dbCliPlugin` in `kick.config.ts`. It reads config from the same
file's `db` block, so there's nothing to wire twice:

```ts
import { defineConfig } from '@forinda/kickjs-cli'
import { dbCliPlugin } from '@forinda/kickjs-db/cli'

export default defineConfig({
  plugins: [dbCliPlugin],
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'sqlite',
    adapter: () => sqliteAdapter({ database: new Database('dev.db') }),
  },
})
```

```bash
kick db generate add_users
kick db migrate review 20260610_..._add_users
kick db migrate latest
```

> The `db` commands are **opt-in** — they are not built into `kick` until
> you add `dbCliPlugin`. (Zero-config db _type generation_ stays built-in;
> only the commands are gated.)

## Option B — standalone `kickjs-db`

Run the same tree without installing `@forinda/kickjs-cli`:

```bash
npx kickjs-db migrate latest
npx kickjs-db generate add_users
```

Config resolves from a standalone `kickjs-db.config.ts` (or a
`kick.config.ts` `db` block — the two merge, later wins):

```ts
// kickjs-db.config.ts
import { defineKickDbConfig } from '@forinda/kickjs-db/cli'
import Database from 'better-sqlite3'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

export default defineKickDbConfig({
  dialect: 'sqlite',
  schemaPath: 'src/db/schema.ts',
  migrationsDir: 'db/migrations',
  adapter: () => sqliteAdapter({ database: new Database('dev.db') }),
  // How `migrate` reacts to out-of-band schema changes (drift):
  // 'error' (default) | 'warn' | 'ignore'.
  driftCheck: 'error',
})
```

`defineKickDbConfig` is the same shape as the `kick.config.ts` `db` block,
so a config authored once drops into either place. `.ts` configs load via
jiti; `.js` / `.mjs` / `.json` work without it.

### Drift detection

`kick db migrate` introspects the live database and compares it to the
last applied snapshot — if someone ran DDL out of band, it stops (`'error'`)
or logs (`'warn'`). It works on all three dialects; SQLite/MySQL
introspection is lossy against a code-first schema (`uuid()` reads back as
`text` / `char(36)`), so the comparison normalises both sides and never
false-positives on the type difference. Set `driftCheck: 'ignore'` to skip
it entirely.

## Config helpers

| Helper                                  | Purpose                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `defineKickDbConfig(cfg)`               | Typed identity helper (vite's `defineConfig` spirit).                         |
| `mergeKickDbConfig(...cfgs)`            | Shallow-merge config layers, later wins.                                      |
| `resolveKickDbConfig(block)`            | Apply defaults → a resolved `DbConfig`.                                       |
| `registerDbCommands(parent, getConfig)` | Attach the command tree to any commander command (used to build custom bins). |
