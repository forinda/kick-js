# Plugin Generators

KickJS plugins can ship their own `kick g <name>` scaffolders the same way the framework's built-in generators do. Adopters install the plugin, run `kick g --list`, and the plugin's generators show up alongside `module`, `service`, `controller`, etc.

## Author a generator

Inside your plugin package, create a manifest file that exports a `GeneratorSpec[]` as the default export:

```ts
// src/generators.ts
import { defineGenerator } from '@forinda/kickjs-cli'

export default [
  defineGenerator({
    name: 'command',
    description: 'Generate a CQRS command + handler',
    args: [{ name: 'name', required: true }],
    files: (ctx) => [
      {
        path: `src/modules/${ctx.kebab}/commands/create-${ctx.kebab}.command.ts`,
        content: `// Command for ${ctx.pascal}\nexport class Create${ctx.pascal}Command {}\n`,
      },
      {
        path: `src/modules/${ctx.kebab}/commands/create-${ctx.kebab}.handler.ts`,
        content: `// Handler for ${ctx.pascal}\nexport class Create${ctx.pascal}Handler {}\n`,
      },
    ],
  }),
]
```

Compile that to JS as part of your plugin's normal build, then point `package.json` at the output:

```json
{
  "name": "@my-org/kickjs-cqrs",
  "kickjs": {
    "generators": "./dist/generators.js"
  }
}
```

That's it — adopters who install your plugin get `kick g command Order` for free.

## GeneratorContext

The `ctx` argument handed to `files()` carries pre-computed name variants and project metadata so you don't reinvent case conversions in every generator:

```ts
interface GeneratorContext {
  name: string         // raw input
  pascal: string       // 'UserPost'
  camel: string        // 'userPost'
  kebab: string        // 'user-post'
  snake: string        // 'user_post'
  pluralPascal?: string  // 'UserPosts' — present when pluralize is on
  pluralKebab?: string   // 'user-posts'
  pluralCamel?: string   // 'userPosts'
  modulesDir: string   // from kick.config.ts (default 'src/modules')
  cwd: string          // working directory
  args: string[]       // extra positional args
  flags: Record<string, string | boolean>  // command-line flags
}
```

Output paths in `GeneratorFile.path` resolve relative to `ctx.cwd`; absolute paths are used verbatim. Parent directories are created automatically. `--dry-run` works out of the box — if the user passed it, files are previewed instead of written.

## Discovery + dispatch

`kick g --list` walks your project's direct dependencies, opens each `package.json`, and loads any manifest declared via `kickjs.generators`. Discovery is shallow (direct deps only) — transitive plugins must be re-exported by a direct dep to be visible.

`kick g <name> <itemName>` first checks plugin generators by exact-name match. If none claim `<name>`, the CLI falls through to the bare-module shortcut. Built-in generators (`module`, `service`, `controller`, etc.) win over plugin generators with the same name. Among plugins, first-match-wins in dependency declaration order — adopters with conflicts should rename the generator on the plugin side or pin one plugin to a different version.

Failed manifests (missing entry file, default export not an array, entries missing `name`/`files`) appear under the "Failed to load" section in `kick g --list` so adopters can diagnose without grepping `node_modules`.

## Authoring tips

- **Keep `defineGenerator` calls pure.** Don't read the disk, hit the network, or import heavy modules at the top of `generators.ts` — the discovery loader does a dynamic import on every CLI invocation that uses `kick g`.
- **Prefer template literals over template engines.** The generated file content is a string; reach for handlebars/EJS only when you need conditional blocks the literal can't express cleanly.
- **Use `ctx.modulesDir`, not hardcoded `'src/modules'`.** Adopters can override the modules dir in `kick.config.ts`.
- **Document expected flags in `flags`.** They show up in the help output and signal intent even though the CLI doesn't yet enforce them.

## Migration path for first-party generators

The built-in generators (`module`, `controller`, `service`, etc.) live inside `@forinda/kickjs-cli` and currently use a different internal API. They will migrate to `defineGenerator` over time so the same shape works for both first-party and plugin code, but adopters don't need to wait — plugin generators are fully usable today.
