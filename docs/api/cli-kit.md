# @forinda/kickjs-cli-kit

The CLI-plugin contract: `defineCliPlugin`, `defineGenerator`, and the types a plugin implements to add commands, typegens and `kick g` generators to the `kick` CLI. It is a separate, dependency-free package so a library can ship CLI commands without depending on `@forinda/kickjs-cli` (which would create a cycle when the CLI depends on that library).

How plugins are registered and run is covered in [CLI plugins](../guide/cli-plugins.md) and [Plugin generators](../guide/plugin-generators.md).

## Install

```bash
pnpm add -D @forinda/kickjs-cli-kit
```

Peer dependency: `commander` (`>=12.0.0`), for the `Command` type passed to `register()`.

## Entry points

| Import path               | Exports                                                                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forinda/kickjs-cli-kit` | `defineCliPlugin`, `defineGenerator`, `KickPluginConflictError`, and the types `KickCliPlugin`, `KickCliPluginContext`, `KickCommandDefinition`, `CliTypegen`, `DiscoveredGenerator`, `GeneratorSpec`, `GeneratorContext`, `GeneratorFile`, `GeneratorArg`, `GeneratorFlag` |

## defineCliPlugin

Identity helper for type inference. Returns the plugin unchanged.

```typescript
function defineCliPlugin<TConfig = unknown>(p: KickCliPlugin<TConfig>): KickCliPlugin<TConfig>
```

```ts
import { defineCliPlugin } from '@forinda/kickjs-cli-kit'

export const migrationsPlugin = () =>
  defineCliPlugin({
    name: 'my-migrations',
    commands: [
      {
        name: 'db:migrate',
        description: 'Apply pending migrations',
        steps: 'node scripts/migrate.js',
      },
    ],
    register(program, ctx) {
      program
        .command('db:status')
        .description('Show migration status')
        .action(() => ctx.log(`project root: ${ctx.projectRoot}`))
    },
  })
```

Register it in `kick.config.ts`: `defineConfig({ plugins: [migrationsPlugin()] })`.

### KickCliPlugin

| Field        | Type                                                                              | Description                                                           |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `name`       | `string`                                                                          | Stable identifier, used in conflict errors and de-duplication.        |
| `commands`   | `KickCommandDefinition[]`                                                         | Declarative shell commands.                                           |
| `register`   | `(program: Command, ctx: KickCliPluginContext<TConfig>) => void \| Promise<void>` | Programmatic registration with commander, called once at CLI startup. |
| `typegens`   | `CliTypegen[]`                                                                    | Typegen plugins the CLI runs after its own pass.                      |
| `generators` | `GeneratorSpec[]`                                                                 | `kick g <name>` scaffolders.                                          |

All fields except `name` are optional.

### KickCliPluginContext

Passed to `register()`.

| Field         | Type                    | Description                                                                                            |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `cwd`         | `string`                | Directory the CLI was invoked from (may be a subdirectory).                                            |
| `projectRoot` | `string`                | Nearest ancestor with `kick.config.{ts,js,mjs,json}` (or `package.json`). Prefer it for writing files. |
| `config`      | `TConfig \| null`       | The loaded `kick.config`.                                                                              |
| `log`         | `(msg: string) => void` | CLI logger.                                                                                            |
| `generators`  | `DiscoveredGenerator[]` | Plugin generators merged by the CLI, each `{ source, spec }` with `source` the plugin name.            |

### KickCommandDefinition

Same shape as the `commands` field of `kick.config.ts`.

```typescript
interface KickCommandDefinition {
  name: string // e.g. 'db:migrate'
  description: string // shown in --help
  steps: string | string[] // shell command(s), run in order; `{args}` is replaced by forwarded CLI args
  aliases?: string[]
}
```

### CliTypegen

Structural shape of a typegen plugin; the CLI's `TypegenPlugin` satisfies it.

```typescript
interface CliTypegen {
  id: string
  inputs: string[]
  outExtension?: string
  generate(ctx: any): Promise<string | null>
}
```

See [Typegen plugins](../guide/cli-plugins.md#typegen-plugins) for the context the CLI passes.

## defineGenerator

Identity factory for a `kick g <name>` generator.

```typescript
function defineGenerator(spec: GeneratorSpec): GeneratorSpec
```

```ts
import { defineGenerator } from '@forinda/kickjs-cli-kit'

export const commandGenerator = defineGenerator({
  name: 'command',
  description: 'Generate a CQRS command + handler',
  args: [{ name: 'name', required: true }],
  files: (ctx) => [
    {
      path: `${ctx.modulesDir}/${ctx.kebab}/commands/create-${ctx.kebab}.command.ts`,
      content: `export class Create${ctx.pascal}Command {}\n`,
    },
  ],
})
```

### GeneratorSpec

| Field         | Type                                                                     | Description                                                                  |
| ------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `name`        | `string`                                                                 | Dispatch name, matched exactly after the built-in generators.                |
| `description` | `string`                                                                 | Shown in `kick g --list` and `--help`.                                       |
| `args`        | `readonly GeneratorArg[]`                                                | `{ name, required?, description? }` — informational, shown in help.          |
| `flags`       | `readonly GeneratorFlag[]`                                               | `{ name, alias?, description?, takesValue? }` — boolean unless `takesValue`. |
| `files`       | `(ctx: GeneratorContext) => GeneratorFile[] \| Promise<GeneratorFile[]>` | Builds the output files for one invocation.                                  |

### GeneratorContext

| Field          | Type                                | Description                                                                |
| -------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `name`         | `string`                            | Name as typed (`UserPost`).                                                |
| `pascal`       | `string`                            | `UserPost`                                                                 |
| `kebab`        | `string`                            | `user-post`                                                                |
| `camel`        | `string`                            | `userPost`                                                                 |
| `snake`        | `string`                            | `user_post`                                                                |
| `pluralPascal` | `string \| undefined`               | `UserPosts` — set when the project enables `pluralize`.                    |
| `pluralKebab`  | `string \| undefined`               | `user-posts`                                                               |
| `pluralCamel`  | `string \| undefined`               | `userPosts`                                                                |
| `modulesDir`   | `string`                            | Modules directory from `kick.config.ts` (default `'src/modules'`).         |
| `cwd`          | `string`                            | Directory the CLI was invoked from.                                        |
| `projectRoot`  | `string`                            | Directory owning `kick.config.*` (or `package.json`); falls back to `cwd`. |
| `args`         | `string[]`                          | Positional arguments after the name.                                       |
| `flags`        | `Record<string, string \| boolean>` | Flag values — booleans for switches, strings for `--key value`.            |

### GeneratorFile

```typescript
interface GeneratorFile {
  path: string // relative to ctx.cwd, or absolute; parent directories are created
  content: string // written verbatim (UTF-8)
}
```

## KickPluginConflictError

Thrown when two plugins register the same plugin name, command, typegen id or generator name.

```typescript
class KickPluginConflictError extends Error {
  constructor(kind: 'plugin' | 'command' | 'typegen' | 'generator', id: string, owners: string[])
}
```

## See also

- [CLI plugins](../guide/cli-plugins.md)
- [Plugin generators](../guide/plugin-generators.md)
- [`@forinda/kickjs-cli`](./cli.md)
