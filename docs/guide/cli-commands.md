# CLI Commands

The `kick` CLI provides commands for project creation, development, code generation, and custom workflows. It is powered by Commander.js and reads project-level configuration from `kick.config.ts`.

## kick new

Create a new KickJS project:

```bash
kick new my-app
kick new my-app --pm npm
kick new my-app -d ./custom-directory
```

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --directory <dir>` | Target directory | Project name |
| `--pm <manager>` | Package manager: `pnpm`, `npm`, or `yarn` | `pnpm` |

The `init` alias also works: `kick init my-app`.

## kick dev

Start the development server with Vite HMR:

```bash
kick dev
kick dev -e src/main.ts
kick dev -p 4000
```

| Flag | Description | Default |
|------|-------------|---------|
| `-e, --entry <file>` | Entry file | `src/index.ts` |
| `-p, --port <port>` | Port number | `3000` (or `PORT` env) |

Under the hood this runs `npx vite-node --watch <entry>`. The `Application.rebuild()` method swaps the Express handler on the existing HTTP server, so database connections and port bindings survive reloads.

## kick dev:debug

Start the dev server with the Node.js inspector attached:

```bash
kick dev:debug
kick dev:debug -p 4000
```

Same flags as `kick dev`. Runs `npx vite-node --inspect --watch <entry>`.

## kick build

Build the project for production using Vite:

```bash
kick build
```

Runs `npx vite build`. Configure output in your `vite.config.ts`.

## kick start

Start the production server:

```bash
kick start
kick start -e dist/main.js
kick start -p 8080
```

| Flag | Description | Default |
|------|-------------|---------|
| `-e, --entry <file>` | Entry file | `dist/index.js` |
| `-p, --port <port>` | Port number | `3000` (or `PORT` env) |

Sets `NODE_ENV=production` automatically.

## kick info

Print system and framework information:

```bash
kick info
```

Output:

```
  KickJS CLI

  System:
    OS:       linux 6.x.x (x64)
    Node:     v20.x.x

  Packages:
    @kickjs/core     workspace
    @kickjs/http     workspace
    @kickjs/config   workspace
    @kickjs/cli      workspace
```

## kick generate (kick g)

Generate code scaffolds. See the [Generators](./generators.md) page for full details.

```bash
kick g module user
kick g controller auth
kick g service payment
kick g middleware logger
kick g guard admin
kick g adapter websocket
kick g dto create-user
```

## Custom Commands

Project-specific commands defined in `kick.config.ts` appear alongside built-in commands. See [Custom Commands](./custom-commands.md) for details.

```bash
kick db:migrate
kick db:seed
kick proto:gen
```

## Port Configuration

Port resolution order:

1. `-p` / `--port` CLI flag
2. `PORT` environment variable
3. `port` option in `bootstrap()` / `ApplicationOptions`
4. Default: `3000`

If the chosen port is in use, the server retries up to 3 times on consecutive ports (3001, 3002, etc.).

## Error Handling

All commands show help text after errors (`program.showHelpAfterError()`). The CLI loads `kick.config.ts` at startup to register custom commands before parsing arguments.
