# @forinda/kickjs-cli-kit

The contract for `kick` CLI plugins: `defineCliPlugin()`, `defineGenerator()` and their types, without depending on `@forinda/kickjs-cli` itself. You need it only to **build** a CLI plugin; `@forinda/kickjs-cli` re-exports all of it for `kick.config.ts`.

## Install

```bash
pnpm add @forinda/kickjs-cli-kit commander
```

## Quick example

```ts
import { defineCliPlugin } from '@forinda/kickjs-cli-kit'

export const helloPlugin = defineCliPlugin({
  name: 'my-org/hello',
  register(program, ctx) {
    program
      .command('hello <name>')
      .description('Say hello')
      .action((name: string) => console.log(`Hello, ${name}! (${ctx.projectRoot})`))
  },
})
```

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { helloPlugin } from './tools/hello-plugin'

export default defineConfig({ plugins: [helloPlugin] })
```

`defineGenerator()` adds a `kick g <name>` scaffolder the same way.

## Documentation

[kickjs.app/guide/cli-plugins](https://kickjs.app/guide/cli-plugins): commands, generators, typegens, conflicts.

## License

MIT
