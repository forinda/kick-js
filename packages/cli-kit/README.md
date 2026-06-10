# @forinda/kickjs-cli-kit

The shared CLI-plugin contract for KickJS. Defines the types and helpers a package implements to ship `kick`-compatible commands, generators, and typegens — without depending on the full `@forinda/kickjs-cli`.

This is a tiny, dependency-free package (one `commander` peer). You only need it if you're **building** a CLI plugin; app authors never import it directly.

## Why this package exists

The kick CLI mounts first-party plugins (the database tooling, for example). If those packages imported `defineCliPlugin` from `@forinda/kickjs-cli` to describe their commands, that would form a dependency cycle — the CLI already depends on them. Hoisting the **contract** into a standalone package both sides import breaks the cycle:

```
@forinda/kickjs-cli  ─┐
                      ├─►  @forinda/kickjs-cli-kit   (contract only)
@forinda/kickjs-db   ─┘
```

`@forinda/kickjs-cli` re-exports the whole contract, so `import { defineCliPlugin } from '@forinda/kickjs-cli'` keeps working for app-side `kick.config.ts` plugins.

## Install

```bash
pnpm add @forinda/kickjs-cli-kit commander
```

`commander` is a peer dependency (the host CLI provides the `Command` your plugin registers against).

## Quick start

### A CLI plugin

```ts
import { defineCliPlugin } from '@forinda/kickjs-cli-kit'

export const helloPlugin = defineCliPlugin({
  name: 'my-org/hello',
  register(program, ctx) {
    program
      .command('hello <name>')
      .description('Say hello')
      .action((name: string) => {
        console.log(`Hello, ${name}! (project: ${ctx.projectRoot})`)
      })
  },
})
```

Mount it in `kick.config.ts`:

```ts
import { defineConfig } from '@forinda/kickjs-cli'
import { helloPlugin } from './tools/hello-plugin'

export default defineConfig({ plugins: [helloPlugin] })
```

```bash
kick hello world
```

### A `kick g <name>` generator

```ts
import { defineGenerator } from '@forinda/kickjs-cli-kit'

export default [
  defineGenerator({
    name: 'widget',
    description: 'Scaffold a widget',
    args: [{ name: 'name', required: true }],
    files: (ctx) => [
      {
        path: `src/widgets/${ctx.kebab}.ts`,
        content: `export class ${ctx.pascal}Widget {}\n`,
      },
    ],
  }),
]
```

## Contract surface

| Export                   | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `defineCliPlugin(p)`     | Declare a CLI plugin: `name` + `register()` / `commands` / `typegens` / `generators`. |
| `defineGenerator(spec)`  | Declare a `kick g <name>` scaffolder (returns the spec, typed).            |
| `KickCliPlugin<TConfig>` | The plugin shape. `TConfig` is the host config type (`ctx.config`).       |
| `KickCliPluginContext`   | What `register()` receives: `cwd`, `projectRoot`, `config`, `log`.        |
| `GeneratorSpec` + co.    | `GeneratorContext` / `GeneratorFile` / `GeneratorArg` / `GeneratorFlag`.  |
| `KickCommandDefinition`  | A declarative shell-handler command (the `commands` field shape).         |
| `CliTypegen`             | Structural typegen shape (the CLI's `TypegenPlugin` satisfies it).        |
| `KickPluginConflictError`| Thrown on duplicate plugin / command / typegen / generator ids.           |

## License

MIT © Felix Orinda
