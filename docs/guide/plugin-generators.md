# Plugin Generators

KickJS plugins can ship their own `kick g <name>` scaffolders the same way the framework's built-in generators do. Adopters install the plugin, run `kick g --list`, and the plugin's generators show up alongside `module`, `service`, `controller`, etc.

::: tip Generators ride on the CLI plugin contract
This page covers generator authoring specifically. For the full plugin shape — `commands`, `register`, `typegens`, `generators`, conflict semantics, and how built-ins use the same contract — see [CLI Plugins](./cli-plugins.md).
:::

## Author a generator

Build the generator with `defineGenerator`, then expose it via the `generators` field of a `KickCliPlugin`:

```ts
// src/index.ts (your plugin entry)
import { defineCliPlugin, defineGenerator } from '@forinda/kickjs-cli'

const actionGen = defineGenerator({
  name: 'action',
  description: 'Generate a service action + handler',
  args: [{ name: 'name', required: true }],
  files: (ctx) => [
    {
      path: `${ctx.modulesDir}/${ctx.kebab}/create-${ctx.kebab}.action.ts`,
      content: `// Action for ${ctx.pascal}\nexport class Create${ctx.pascal}Action {}\n`,
    },
    {
      path: `${ctx.modulesDir}/${ctx.kebab}/create-${ctx.kebab}.handler.ts`,
      content: `// Handler for ${ctx.pascal}\nexport class Create${ctx.pascal}Handler {}\n`,
    },
  ],
})

export const actionPlugin = defineCliPlugin({
  name: 'my-action-plugin',
  generators: [actionGen],
})
```

Adopters wire the plugin in `kick.config.ts`:

```ts
import { defineConfig } from '@forinda/kickjs-cli'
import { actionPlugin } from '@my-org/kickjs-cli-actions'

export default defineConfig({
  plugins: [actionPlugin],
})
```

That's it — `kick g action Order` dispatches against the registered spec.

::: warning Legacy `package.json > kickjs.generators` discovery
The previous shape pointed `package.json` at a compiled manifest:

```json
{
  "kickjs": { "generators": "./dist/generators.js" }
}
```

That discovery path still works as a deprecated fallback for one minor version so existing plugins keep functioning. New plugins should ship generators through `KickCliPlugin.generators[]` so adopters control loading via `kick.config.ts > plugins[]` and benefit from the conflict-detection pipeline.
:::

## GeneratorContext

The `ctx` argument handed to `files()` carries pre-computed name variants and project metadata so you don't reinvent case conversions in every generator:

```ts
interface GeneratorContext {
  name: string // raw input
  pascal: string // 'UserPost'
  camel: string // 'userPost'
  kebab: string // 'user-post'
  snake: string // 'user_post'
  pluralPascal?: string // 'UserPosts' — present when pluralize is on
  pluralKebab?: string // 'user-posts'
  pluralCamel?: string // 'userPosts'
  modulesDir: string // from kick.config.ts (default 'src/modules')
  cwd: string // working directory
  args: string[] // extra positional args
  flags: Record<string, string | boolean> // command-line flags
}
```

Output paths in `GeneratorFile.path` resolve relative to `ctx.cwd`; absolute paths are used verbatim. Parent directories are created automatically. `--dry-run` works out of the box — if the user passed it, files are previewed instead of written.

## Discovery + dispatch

`kick g --list` reads `kick.config.ts > plugins[]`, walks each plugin's `generators` field, and merges those entries with the built-ins. `kick g <name> <itemName>` then dispatches against the registered specs by exact-name match. If no generator claims `<name>`, the CLI falls through to the bare-module shortcut.

Conflict handling rides on the [CLI plugin contract](./cli-plugins.md#conflict-handling): two plugins registering the same generator `name` is a fail-fast at startup, with both plugin names listed in the error. Built-in generators (`module`, `service`, `controller`, etc.) sit at the head of the list and effectively win conflicts because they're registered first by the built-in plugins.

For adopters still on the legacy `package.json > kickjs.generators` discovery path, the CLI continues to walk direct dependencies and surface failed manifests under the "Failed to load" section in `kick g --list` for one more minor version.

## Authoring tips

- **Keep `defineGenerator` calls pure.** Don't read the disk, hit the network, or import heavy modules at the top of your plugin entry — the CLI dynamic-imports your plugin on every invocation that uses `kick g`.
- **Prefer template literals over template engines.** The generated file content is a string; reach for handlebars/EJS only when you need conditional blocks the literal can't express cleanly.
- **Use `ctx.modulesDir`, not hardcoded `'src/modules'`.** Adopters can override the modules dir in `kick.config.ts > modules.dir`, and the typical project layout is a convention — not a requirement.
- **Document expected flags in `flags`.** They show up in the help output and signal intent even though the CLI doesn't yet enforce them.

## Migration path for first-party generators

The built-in generators (`module`, `controller`, `service`, etc.) live inside `@forinda/kickjs-cli` and currently use a different internal API. They will migrate to `defineGenerator` over time so the same shape works for both first-party and plugin code, but adopters don't need to wait — plugin generators are fully usable today.
