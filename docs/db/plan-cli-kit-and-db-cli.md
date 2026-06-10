# Plan — `@forinda/kickjs-cli-kit` + `@forinda/kickjs-db/cli`

> Status: proposal for review
> Goal: ship the `kick db` command tree from `@forinda/kickjs-db/cli` as a
> mountable CLI plugin (+ optional standalone bin), so adopters can use the
> DB tooling without pulling all of `@forinda/kickjs-cli`, and it plugs
> into the same plugin ecosystem. Breaks the `db ↔ cli` dependency cycle
> via a shared contract package (decision: **option A**).

## The cycle to break

`@forinda/kickjs-cli` already depends on `@forinda/kickjs-db` (it mounts
the db commands). If `db` imported `defineCliPlugin` / `KickCliPlugin`
from `@forinda/kickjs-cli`, that's `db → cli` → a cycle. So the CLI-plugin
**contract** moves to a new dependency-free package both import.

## Dependency reality (why the kit can't be a naïve cut-paste)

`KickCliPlugin` today references cli internals:

| Field        | Type                           | Source today                                          |
| ------------ | ------------------------------ | ----------------------------------------------------- |
| `register`   | `(program: Command, ctx) => …` | `commander` (peer)                                    |
| `commands`   | `KickCommandDefinition[]`      | `cli/config` (small, self-contained)                  |
| `typegens`   | `TypegenPlugin[]`              | `cli/typegen/plugin` → `KickConfig` + scanner (deep)  |
| `generators` | `GeneratorSpec[]`              | `cli/generator-extension/define` (**self-contained**) |
| `ctx.config` | `KickConfig \| null`           | `cli/config` (795 lines, deep)                        |

`GeneratorSpec`/`GeneratorContext`/`GeneratorFile` and
`KickCommandDefinition` are self-contained → move wholesale. `KickConfig`
and `TypegenPlugin` are **not** → the kit must reference them _loosely_ so
it doesn't drag half of cli.

## `@forinda/kickjs-cli-kit` contents

Dependency-free except a `commander` peer. Exports:

1. **Moved wholesale** (no edits): `define.ts` → `defineGenerator`,
   `GeneratorSpec`, `GeneratorContext`, `GeneratorFile`, `GeneratorArg`,
   `GeneratorFlag`. And `KickCommandDefinition` (name/description/steps/aliases).
2. **The plugin contract**, with the deep types loosened:

   ```ts
   export interface KickCliPluginContext<TConfig = unknown> {
     cwd: string
     projectRoot: string
     config: TConfig | null            // cli passes its KickConfig; db reads ctx.config.db
     log: (msg: string) => void
     generators?: DiscoveredGeneratorLike[]
   }
   export interface KickCliPlugin<TConfig = unknown> {
     name: string
     commands?: KickCommandDefinition[]
     register?: (program: Command, ctx: KickCliPluginContext<TConfig>) => void | Promise<void>
     typegens?: CliTypegenLike[]        // minimal { id; generate(ctx): … } — TypegenPlugin satisfies it
     generators?: GeneratorSpec[]
   }
   export function defineCliPlugin<T = unknown>(p: KickCliPlugin<T>): KickCliPlugin<T>
   export class KickPluginConflictError extends Error { … }
   ```

   - `TConfig` generic defaults to `unknown` — cli instantiates as
     `KickCliPlugin<KickConfig>`; db uses `KickCliPlugin` and reads
     `ctx.config` as `{ db?: KickDbConfigBlock }` via a local cast.
   - `CliTypegenLike` is the minimal shape cli's `TypegenPlugin`
     structurally satisfies (so the kit never imports the scanner).

## `@forinda/kickjs-cli` changes

- Depend on `@forinda/kickjs-cli-kit`.
- `plugin/types.ts` → re-export the contract from the kit (back-compat:
  `export { defineCliPlugin, KickCliPlugin, … } from '@forinda/kickjs-cli-kit'`),
  and narrow `KickCliPluginContext<KickConfig>` where it consumes it.
- `generator-extension/define.ts` → re-export from the kit (the file moved).
- `merge.ts` / `cli.ts` keep working — they already operate on the contract.
- **Mount the db plugin instead of hardcoding** `registerDbCommands`:
  `cli.ts` adds the db CLI plugin to `builtinCliPlugins` (so `kick db`
  works out of the box). `commands/db.ts` is deleted (logic moved to db).

## `@forinda/kickjs-db/cli`

- New subpath entry `src/cli.ts` (+ tsdown entry + `./cli` export).
- Depends on `@forinda/kickjs-cli-kit` + `commander` (peer).
- Exports `dbCliPlugin` (a `defineCliPlugin`) — its `register(program, ctx)`
  builds the `db` command tree (generate / migrate latest|up|down|rollback|status|review / introspect), reading config from `ctx.config.db` and `ctx.projectRoot`.
- The command bodies move verbatim from `cli/src/commands/db.ts`, with two
  swaps: config comes from `ctx.config` (not `loadKickConfig`), and the pg
  adapter import already points at `@forinda/kickjs-db/pg` (in-package).
- **Standalone bin** `bin/kickjs-db.mjs`: a ~15-line commander program that
  loads `kick.config.{ts,js}` (jiti, optional dep) and calls the plugin's
  `register()`. Lets `npx kickjs-db migrate latest` work without kickjs-cli.

## Open micro-decisions (defaults if unanswered)

1. **Standalone bin** — ship it? _Default: yes_ (the whole point of "use db without kickjs-cli").
2. **kickjs-cli mounts db plugin** — by default, or only when in `kick.config.ts plugins[]`? _Default: by default_ (so `kick db` keeps working with zero config; still available as a plugin for other CLIs).

## Changeset

- `@forinda/kickjs-cli-kit` — new package, `0.1.0` (or `1.0.0`).
- `@forinda/kickjs-cli` — minor (contract re-exported from kit; db commands now via plugin). Non-breaking for adopters importing `defineCliPlugin` from `@forinda/kickjs-cli` (re-exported).
- `@forinda/kickjs-db` — minor (`/cli` subpath + bin + cli-kit dep).

## Risks

- **commander version skew** — kit, cli, db must agree on `commander` (peer-pin a single range).
- **`ctx.config` loose typing** — db casts `ctx.config` to read `.db`; a typo wouldn't be caught by the kit. Mitigation: db defines a local `{ db?: KickDbConfigBlock }` view + asserts shape at runtime (it already defaults each field).
- **Back-compat** — keep `cli`'s `defineCliPlugin`/`defineGenerator` re-exports so existing adopter `kick.config.ts` imports don't break.
- **Bin config loading** — the standalone bin needs a jiti (optional) to read a `.ts` config; document that `.js`/`.mjs`/`.json` configs work without it.
