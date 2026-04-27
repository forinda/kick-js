# CLI Plugins

Extend the `kick` CLI with new commands and typegen emitters by writing
a `KickCliPlugin` and adding it to `kick.config.ts`. The same contract
backs every built-in command — `kick init`, `kick generate`, `kick db`
all ship as plugins internally.

## When to write one

- You publish a package that wants to add a `kick <name>` subcommand
  (e.g. `@forinda/kickjs-cli-drizzle` adding `kick db:migrate`).
- You need to emit a `.d.ts` file under `.kickjs/types/` from project
  sources (typegen plugin) — Vite, schema, route map, anything.
- You want to bundle commands + typegens in one install for adopters.

If you only need a single shell-handler command (e.g. `kick seed`),
adopter-level `commands` in `kick.config.ts` is simpler — the plugin
shape is for distributable packages.

## The shape

```ts
import type { Command } from 'commander'

interface KickCliPlugin {
  /** Stable id — used in error messages on conflict, must be unique. */
  name: string
  /** Declarative commands — same shape as kick.config.ts `commands`. */
  commands?: KickCommandDefinition[]
  /** Programmatic registration — full commander API. */
  register?: (program: Command) => void | Promise<void>
  /** Typegen emitters that run during `kick typegen`. */
  typegens?: TypegenPlugin[]
}
```

All three contribution kinds are optional; pick whichever fit. Use
`defineCliPlugin` so types flow:

```ts
import { defineCliPlugin } from '@forinda/kickjs-cli'

export const drizzlePlugin = (opts: { schemaPath?: string } = {}) =>
  defineCliPlugin({
    name: 'kickjs-cli-drizzle',
    commands: [
      {
        name: 'db:migrate',
        description: 'Apply pending Drizzle migrations',
        steps: 'npx drizzle-kit migrate',
      },
    ],
    typegens: [drizzleTypegen(opts)],
  })
```

## Registering in kick.config.ts

```ts
import { defineConfig } from '@forinda/kickjs-cli'
import { drizzlePlugin } from '@forinda/kickjs-cli-drizzle'

export default defineConfig({
  plugins: [drizzlePlugin({ schemaPath: 'src/db/schema' })],
})
```

CLI startup loads the config, walks `plugins[]` in array order, and
merges with the built-ins. Plugin commands appear first; adopter
`commands` in the same config override plugin commands of the same name.

## Conflict handling

The CLI fails fast at startup on three duplicate signals:

- two plugins sharing the same `name`
- two plugins registering the same command name
- two plugins registering the same typegen `id`

The error message lists both plugin names so the source is obvious.
Adopter `commands` in `kick.config.ts` overriding a plugin command is
*not* a conflict — that's the documented override path.

## Programmatic command registration

Use `register` when commander's chain API is needed (subcommands,
options with parsers, async actions, etc.):

```ts
defineCliPlugin({
  name: 'my-tool',
  register(program) {
    program
      .command('my-tool')
      .description('Do the thing')
      .option('--watch', 'Watch mode')
      .action(async (opts) => {
        // ...
      })
  },
})
```

`register` runs once at CLI startup with the same `Command` instance
the built-ins use. Don't re-register the same command name another
plugin already owns — there's no automatic conflict detection inside
`register` callbacks (only on declarative `commands[]`). Pick a
namespaced prefix (`my-tool:foo`) to stay safe.

## Typegen plugins

Each `TypegenPlugin` owns one file under `.kickjs/types/<id>.d.ts`
(slashes in id become `__`). The runner re-runs the plugin when its
`inputs` globs change (Vite watcher integration lands in M2.B-T10).

```ts
import type { TypegenPlugin } from '@forinda/kickjs-cli'

const drizzleTypegen = (): TypegenPlugin => ({
  id: 'drizzle/db',
  inputs: ['src/db/schema.ts', 'src/db/schema/**/*.ts'],
  async generate(ctx) {
    // Read project sources via ctx.cwd, compute the augmentation,
    // return a TS source string (no banner — the runner prepends one).
    return `export type DrizzleDb = ${'/* ... */'}`
  },
})
```

`kick typegen` runs every plugin's `generate()`; `kick typegen --check`
fails non-zero on drift instead of writing — wire it into CI to keep
generated declarations in sync with code.

## Built-ins use the same contract

Every built-in command — `init`, `generate`, `run`, `info`, `inspect`,
`add`, `list`, `explain`, `mcp`, `tinker`, `remove`, `typegen`,
`check`, `db` — ships as a `KickCliPlugin` in
`packages/cli/src/plugin/builtins.ts`. Adding a built-in command means
appending one entry there; the merge + conflict pipeline runs the same
way for built-ins and adopter plugins.
