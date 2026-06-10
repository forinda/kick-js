---
title: CLI Plugins
subtitle: Extend the kick CLI
number: '06'
tag: Tooling
accent: '#ef4444'
---

# CLI Plugins & Generators

The `kick` CLI is itself a set of plugins. You extend it the same way — add commands and `kick g <name>` generators from your own package, via `@forinda/kickjs-cli-kit`.

## A command plugin

```ts
import { defineCliPlugin } from '@forinda/kickjs-cli-kit'

export const helloPlugin = defineCliPlugin({
  name: 'my-org/hello',
  register(program, ctx) {
    program
      .command('hello <name>')
      .description('Say hello')
      .action((name: string) => {
        console.log(`Hello, ${name}! (root: ${ctx.projectRoot})`)
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

## A generator

`kick g widget Order` scaffolds files from a template:

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

`ctx` carries naming variants (`pascal`, `kebab`, `camel`, `snake`, pluralised forms) so templates stay readable.

## Ship it without the whole CLI

`@forinda/kickjs-cli-kit` is dependency-free (one `commander` peer). A package can ship `kick`-compatible commands **without** depending on `@forinda/kickjs-cli` — that's how `@forinda/kickjs-db/cli` ships the `kick db` tree and a standalone `kickjs-db` bin.

## Why it matters

- **One CLI, many extensions** — your repo's scaffolders live next to the framework's, same `kick g` UX.
- **No cycle** — the contract lives in a tiny shared package, so first-party packages mount cleanly.
- **Distribute tooling** — publish a plugin; adopters add one line to `kick.config.ts`.

## Back to the [index](./README.md)
