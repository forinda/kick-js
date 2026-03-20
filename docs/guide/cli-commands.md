# CLI Commands

The `kick` CLI provides commands for project creation, development, code generation, and custom workflows. It is powered by Commander.js and reads project-level configuration from `kick.config.ts`.

## Installation

### For users (building apps with KickJS)

Install the published CLI globally:

```bash
# pnpm
pnpm add -g @forinda/kickjs-cli

# npm
npm install -g @forinda/kickjs-cli

# yarn
yarn global add @forinda/kickjs-cli
```

Verify it's available:

```bash
kick --version
```

Or use `npx` without a global install:

```bash
npx @forinda/kickjs-cli new my-api
```

### For contributors (working on the KickJS monorepo)

::: warning Important
If you're contributing to KickJS, **always link the local CLI** instead of using the published npm version. The published version may not include your latest changes, which means scaffolding and generators could be out of sync with the framework.
:::

Link your local build globally so `kick` always points to your dev version:

```bash
# From the repo root — build first, then link
pnpm build
cd packages/cli
pnpm link --global
```

This makes `kick` behave like `ng` for Angular — it's globally available and always runs your local code. After making CLI changes:

```bash
# Just rebuild — no need to re-link
pnpm build
```

The linked `kick` picks up changes immediately.

To check which version you're running:

```bash
kick --version          # Shows the version
which kick              # Shows the linked path — should point to your repo
```

To unlink and switch back to the published version:

```bash
pnpm uninstall -g @forinda/kickjs-cli
pnpm add -g @forinda/kickjs-cli
```

## kick new

Create a new KickJS project:

```bash
kick new my-app            # Interactive prompts for PM, git, install
kick new .                 # Scaffold in current directory
kick new my-app --pm pnpm  # Skip PM prompt
kick new my-app --git --install  # Non-interactive
kick new my-app --no-git --no-install  # Skip git and install
kick new my-app -d ./custom-directory
```

When run without flags, the CLI prompts for:
1. **Package manager** — pnpm, npm, or yarn
2. **Git init** — initialize a git repository with an initial commit
3. **Install deps** — run the selected package manager's install command

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --directory <dir>` | Target directory | Project name |
| `--pm <manager>` | Package manager: `pnpm`, `npm`, or `yarn` | Prompted |
| `--git / --no-git` | Initialize git repository | Prompted |
| `--install / --no-install` | Install dependencies | Prompted |
| `-f, --force` | Clear non-empty directory without prompting | `false` |

Use `.` as the project name to scaffold in the current directory (the folder name becomes the project name).

The `init` alias also works: `kick init my-app`.

**Non-empty directory safety:** If the target directory already contains files, the CLI shows up to 5 existing entries and asks for confirmation before clearing them. Use `--force` to skip the prompt.

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
    @forinda/kickjs-core     workspace
    @forinda/kickjs-http     workspace
    @forinda/kickjs-config   workspace
    @forinda/kickjs-cli      workspace
```

## kick generate (kick g)

Generate code scaffolds. See the [Generators](./generators.md) page for full details.

```bash
kick g module user       # Generates 18 files with DDD structure, tests, and API decorators
kick g controller auth
kick g service payment
kick g middleware logger
kick g guard admin
kick g adapter websocket
kick g dto create-user
kick g config
```

### kick g config

Generate a `kick.config.ts` at the project root. Useful for existing projects created before the CLI included this file.

```bash
kick g config                        # Interactive — prompts if file exists
kick g config --force                # Overwrite without prompting
kick g config --modules-dir src/mods # Custom modules directory
kick g config --repo drizzle         # Default repo type
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --force` | Overwrite existing config without prompting | `false` |
| `--modules-dir <dir>` | Modules directory path | `src/modules` |
| `--repo <type>` | Default repository type: `inmemory` or `drizzle` | `inmemory` |

If `kick.config.ts` already exists, the CLI prompts for confirmation before overwriting.

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
