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

interface KickCliPluginContext {
  cwd: string
  config: KickConfig | null
  log: (msg: string) => void
}

interface KickCliPlugin {
  /** Stable id — used in error messages on conflict, must be unique. */
  name: string
  /** Declarative commands — same shape as kick.config.ts `commands`. */
  commands?: KickCommandDefinition[]
  /** Programmatic registration — full commander API. Receives ctx. */
  register?: (program: Command, ctx: KickCliPluginContext) => void | Promise<void>
  /** Typegen emitters that run during `kick typegen`. */
  typegens?: TypegenPlugin[]
  /** `kick g <name>` scaffolders (defineGenerator). Replaces the
   *  legacy `package.json > kickjs.generators` discovery path. */
  generators?: GeneratorSpec[]
}
```

All four contribution kinds are optional; pick whichever fit. Use
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

The CLI fails fast at startup on four duplicate signals:

- two plugins sharing the same `name`
- two plugins registering the same command name
- two plugins registering the same typegen `id`
- two plugins registering the same generator `name`

The error message lists both plugin names so the source is obvious.
Adopter `commands` in `kick.config.ts` overriding a plugin command is
*not* a conflict — that's the documented override path.

## Programmatic command registration

Use `register` when commander's chain API is needed (subcommands,
options with parsers, async actions, etc.):

```ts
defineCliPlugin({
  name: 'my-tool',
  register(program, ctx) {
    program
      .command('my-tool')
      .description('Do the thing')
      .option('--watch', 'Watch mode')
      .action(async (opts) => {
        ctx.log(`running my-tool from ${ctx.cwd}`)
        // ctx.config is the loaded kick.config.ts
      })
  },
})
```

`register` runs once at CLI startup with the same `Command` instance
the built-ins use, plus a `KickCliPluginContext` so the callback has
cwd + config without re-loading. Don't re-register the same command
name another plugin already owns — there's no automatic conflict
detection inside `register` callbacks (only on declarative
`commands[]`). Pick a namespaced prefix (`my-tool:foo`) to stay safe.

## Generator plugins

`generators?: GeneratorSpec[]` ships `kick g <name>` scaffolders the
same way the framework's built-ins do. Use `defineGenerator` to author
the spec, then expose it via the plugin:

```ts
import { defineCliPlugin, defineGenerator } from '@forinda/kickjs-cli'

const cqrsCommandGen = defineGenerator({
  name: 'command',
  description: 'Generate a CQRS command + handler',
  args: [{ name: 'name', required: true }],
  files: (ctx) => [
    {
      path: `src/modules/${ctx.kebab}/commands/create-${ctx.kebab}.command.ts`,
      content: `// generated for ${ctx.pascal}\n`,
    },
  ],
})

export const cqrsPlugin = defineCliPlugin({
  name: 'kickjs-cli-cqrs',
  generators: [cqrsCommandGen],
})
```

`kick g command Order` then dispatches against the registered spec —
config-supplied generators take priority over the legacy
`package.json > kickjs.generators` discovery path, which stays around
as a deprecated fallback for one minor version.

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

### Inspecting + disabling typegens

`kick typegen --list` prints every registered plugin id alongside its
watched inputs. Disabled entries show `(disabled)`:

```
  Registered typegen plugins:

    kick/db      inputs: src/db/schema.ts, src/db/schema/**/*.ts
    kick/assets  inputs: kick.config.ts, kick.config.js, kick.config.mjs
```

Adopters who want to skip a built-in typegen (e.g. hand-write the
`KickDbRegister` augmentation manually) opt out via
`kick.config.ts > typegen.disable`:

```ts
export default defineConfig({
  typegen: { disable: ['kick/db'] },
})
```

The plugin still loads and merge-time conflict detection still runs;
only the `generate()` invocation is skipped. Unknown ids surface as a
startup warning rather than failing the run, so a typo doesn't break
the dev loop. See [Typegen → Disabling specific plugin
typegens](./typegen.md#disabling-specific-plugin-typegens) for the
full pattern.

## Built-ins use the same contract

Every built-in command — `init`, `generate`, `run`, `info`, `inspect`,
`add`, `list`, `explain`, `mcp`, `tinker`, `remove`, `typegen`,
`check`, `db` — ships as a `KickCliPlugin` in
`packages/cli/src/plugin/builtins.ts`. Adding a built-in command means
appending one entry there; the merge + conflict pipeline runs the same
way for built-ins and adopter plugins.
