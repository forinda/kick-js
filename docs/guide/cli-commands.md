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
kick new my-app                          # Interactive prompts for everything
kick new my-app --yes                    # Pick all defaults (minimal + inmemory)
kick new .                               # Scaffold in current directory
kick new my-app --pm pnpm                # Skip PM prompt only
kick new my-app -t ddd --pm pnpm --no-git --install  # Fully scriptable
```

`-y, --yes` (alias `--non-interactive`) bypasses every prompt and picks safe defaults — usable in CI pipelines and one-liner shell scripts:

```bash
# Single-flag fully non-interactive — no TTY required
kick new my-api --yes
```

`--yes` defaults:

| Setting | Default value |
|---------|---------------|
| Template | `minimal` |
| Repository | `inmemory` |
| Optional packages | none |
| Git init | enabled |
| Install deps | enabled |
| Package manager | resolved via `kick add`'s chain (config → corepack `packageManager` → lockfile → npm) |

Any explicit flag overrides the matching default — `--yes --template rest --repo drizzle` scaffolds a REST + Drizzle project without prompts.

When run without `--yes` (and without specific flags), the CLI prompts for:
1. **Project template** — REST, DDD, CQRS, or Minimal
2. **Package manager** — pnpm, npm, yarn, or bun
3. **Default repository** — Prisma, Drizzle, In-Memory, or Custom ORM
4. **Optional packages** — auth, swagger, ws, queue, devtools
5. **Git init** — initialize a git repository with an initial commit
6. **Install deps** — run the selected package manager's install command

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --template <type>` | Project template: `rest`, `ddd`, `cqrs`, `minimal` | Prompted (or `minimal` with `--yes`) |
| `-r, --repo <type>` | Default repository: `prisma`, `drizzle`, `inmemory`, `custom` | Prompted (or `inmemory` with `--yes`) |
| `-d, --directory <dir>` | Target directory | Project name |
| `--pm <manager>` | Package manager: `pnpm`, `npm`, `yarn`, or `bun` | Prompted (or auto-detected with `--yes`) |
| `--packages <list>` | Comma-separated optional packages | Prompted (or none with `--yes`) |
| `--git / --no-git` | Initialize git repository | Prompted (or `true` with `--yes`) |
| `--install / --no-install` | Install dependencies | Prompted (or `true` with `--yes`) |
| `-f, --force` | Clear non-empty directory without prompting | `false` |
| `-y, --yes`, `--non-interactive` | Bypass every prompt with safe defaults | `false` |

### Templates

| Template | Adapters | Packages installed |
|----------|----------|-------------------|
| `rest` (default) | Swagger + DevTools | kickjs, kickjs-vite, kickjs-swagger |
| `ddd` | Swagger + DevTools | kickjs, kickjs-vite, kickjs-swagger |
| `cqrs` | Swagger + WS + Queue + DevTools | kickjs, kickjs-vite, kickjs-swagger, kickjs-ws, kickjs-queue |
| `minimal` | None | kickjs, kickjs-vite |

Use `.` as the project name to scaffold in the current directory (the folder name becomes the project name).

The `init` alias also works: `kick init my-app`.

**Non-empty directory safety:** If the target directory already contains files, the CLI shows up to 5 existing entries and asks for confirmation before clearing them. Use `--force` to skip the prompt. Running with `--yes` *without* `--force` aborts cleanly when the directory is non-empty — the non-interactive flag never silently destroys existing work.

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

Changes to your source files are picked up instantly — database connections, WebSocket state, and port bindings survive reloads.


## kick dev:debug

Start the dev server with the Node.js debugger attached:

```bash
kick dev:debug
kick dev:debug -p 4000
```

Same flags as `kick dev`. Opens a debug port so you can attach Chrome DevTools or your IDE's debugger.

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
    @forinda/kickjs           workspace
    @forinda/kickjs-vite      workspace
    @forinda/kickjs-cli       workspace
```

## kick list

List the core KickJS packages every project ships with. Alias: `kick ls`. Pair with `--all` to dump the full optional catalog (which churns between releases — packages added, deprecated, removed — so the default view stays stable).

```bash
kick list                 # core only
kick list --all           # full catalog
kick ls                   # alias
```

Default output (3 core packages):

```
  Core packages (always installed by `kick new`):

    kickjs           Unified framework: DI, decorators, routing, middleware (+ express)
    vite             Vite plugin: dev server, HMR, module discovery (+ vite)
    cli              CLI tool and code generators

  Plus N optional packages (auth, swagger, db, queue, …).
  Run `kick list --all` for the full catalog.
```

`kick list --all` adds the **Optional packages** section beneath the core list — what's actually shipped in the `kick add` registry at this CLI version. Names there are stable, but membership rotates as the framework evolves, so we do not enumerate them in this guide.

## kick add

Add KickJS packages with their required peer dependencies automatically resolved.

```bash
kick add swagger          # installs @forinda/kickjs-swagger
kick add drizzle auth     # installs multiple packages at once
kick add queue:bullmq     # installs queue package + bullmq + ioredis
kick add --list           # show core packages (alias: kick list)
kick add --list --all     # full optional catalog
```

### Core packages

`kick add --list` defaults to the three core packages every project always installs. The optional catalog moves between releases (packages added, deprecated, removed) so the live list lives behind `--all`:

```text
  Core packages (always installed by `kick new`):

    kickjs           Unified framework: DI, decorators, routing, middleware (+ express)
    vite             Vite plugin: dev server, HMR, module discovery (+ vite)
    cli              CLI tool and code generators

  Plus N optional packages (auth, swagger, db, queue, …).
  Run `kick add --list --all` for the full catalog.
```

The framework runtime (`@forinda/kickjs`), the dev/build/HMR layer (`@forinda/kickjs-vite`), and the CLI (`@forinda/kickjs-cli`) are the only members of the core set. Everything else — auth, swagger, db, drizzle, prisma, ws, queue, devtools, mcp, testing — is opt-in via `kick add`.

### Package manager resolution

`kick add` picks the package manager from this chain (highest priority first):

1. `--pm` flag
2. `packageManager` field in `kick.config.ts`
3. `packageManager` field in the **nearest ancestor** `package.json` (corepack)
4. **Nearest ancestor** lockfile (`pnpm-lock.yaml` → `yarn.lock` → `bun.lock` → `package-lock.json`)
5. `npm` fallback

The "nearest ancestor" climb means a workspace sub-package inherits the workspace root's pm, even when the sub-package's own `package.json` omits `packageManager`. Run `kick add <pkg>` from any directory under a pnpm workspace and it picks pnpm. The output prints the resolved source so the path is visible:

```text
  Using pnpm (resolved from package.json)
```

### Flags

| Flag | Description |
|------|-------------|
| `--pm <manager>` | Package manager override (auto-detected via the chain above) |
| `-D, --dev` | Install as dev dependency |
| `--list` | List packages (core only by default) |
| `--all` | When paired with `--list`, include the full optional catalog |

## kick generate (kick g)

Generate code scaffolds. See the [Generators](./generators.md) page for full details.

```bash
kick g --list            # List all available generators
kick g module user       # Structure depends on pattern in kick.config.ts
kick g module user --pattern rest  # Force flat REST structure
kick g resolver product  # GraphQL resolver with @Query/@Mutation/@Arg
kick g job email         # Queue job processor with @Job/@Process
kick g scaffold Post title:string body:text:optional  # CRUD from fields
kick g controller auth
kick g service payment
kick g middleware logger
kick g guard admin
kick g adapter websocket
kick g dto create-user
kick g auth-scaffold             # Complete auth module (register/login/logout)
kick g auth-scaffold -s session  # Session-based variant
kick g config
kick g agents -f                 # Refresh AGENTS.md / CLAUDE.md / kickjs-skills.md
```

### kick g scaffold

Generate a full CRUD module from field definitions. Fields use `name:type` format. Append `:optional` for optional fields (shell-safe).

```bash
kick g scaffold Post title:string body:text:optional published:boolean:optional
kick g scaffold User name:string email:email:optional role:enum:admin,user,guest
```

#### Field Types

| Type | TypeScript | Zod | Example |
|------|-----------|-----|---------|
| `string` | `string` | `z.string()` | `title:string` |
| `text` | `string` | `z.string()` | `body:text` |
| `number` | `number` | `z.number()` | `price:number` |
| `int` | `number` | `z.number().int()` | `age:int` |
| `float` | `number` | `z.number()` | `rating:float` |
| `boolean` | `boolean` | `z.boolean()` | `active:boolean` |
| `date` | `string` | `z.string().datetime()` | `createdAt:date` |
| `email` | `string` | `z.string().email()` | `email:email` |
| `url` | `string` | `z.string().url()` | `website:url` |
| `uuid` | `string` | `z.string().uuid()` | `externalId:uuid` |
| `json` | `any` | `z.any()` | `metadata:json` |
| `enum:a,b,c` | `'a' \| 'b' \| 'c'` | `z.enum(['a','b','c'])` | `status:enum:draft,published` |

#### Scaffold Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--no-entity` | Skip entity and value object generation | `false` |
| `--no-tests` | Skip test file generation | `false` |
| `--no-pluralize` | Use singular names | from config |
| `--modules-dir <dir>` | Modules directory | `src/modules` |

::: tip Shell-safe optional syntax
Use `name:type:optional` instead of `"name:type?"` — the `?` character is a shell glob in bash/zsh and needs quoting.
:::

See [Generators — kick g scaffold](./generators.md#kick-g-scaffold) for full details.

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
| `--repo <type>` | Default repository type: `inmemory`, `drizzle`, or `prisma` | `inmemory` |

If `kick.config.ts` already exists, the CLI prompts for confirmation before overwriting.

### kick g agents

Regenerate the AI-agent documentation trio (`AGENTS.md`, `CLAUDE.md`, `kickjs-skills.md`) from the latest CLI templates. Use after a KickJS upgrade to pull in new conventions and gotchas without copy-pasting between projects.

```bash
kick g agents                      # All three (prompts before overwrite)
kick g agents -f                   # All three, no prompt
kick g agents -f --only skills     # Just kickjs-skills.md
kick g agents -f --only claude     # Just CLAUDE.md
kick g agents -f --only agents     # Just AGENTS.md
kick g agents -f --only both       # AGENTS.md + CLAUDE.md (skip skills)
```

Aliases: `kick g agent-docs`, `kick g ai-docs`. Auto-detects project name (from `package.json`), package manager (corepack `packageManager` field), and template (from `kick.config.ts` `pattern`).

| Flag | Description | Default |
|------|-------------|---------|
| `--only <which>` | `agents` \| `claude` \| `skills` \| `both` \| `all` | `all` |
| `--name <name>` | Project name override | from `package.json` |
| `--pm <pm>` | Package manager override | from `package.json` |
| `--template <template>` | `rest` \| `ddd` \| `cqrs` \| `minimal` | from `kick.config.ts` |
| `-f, --force` | Overwrite without prompting | `false` |

See [Generators — kick g agents](./generators.md#kick-g-agents) for what each file contains and how to keep local customisations from being overwritten.

## Custom Commands

Project-specific commands defined in `kick.config.ts` appear alongside built-in commands. See [Custom Commands](./custom-commands.md) for project-local commands, or [CLI Plugins](./cli-plugins.md) for shipping commands, generators, and typegens as installable packages.

```bash
kick db:migrate
kick db:seed
kick proto:gen
```

## kick inspect

Inspect a running KickJS application and display diagnostic information including registered routes, middleware, adapters, and DI container state.

```bash
kick inspect                      # Inspect localhost:3000
kick inspect http://localhost:4000  # Inspect a specific URL
kick inspect --port 4000          # Shorthand for custom port
kick inspect --watch              # Re-inspect on changes (live reload)
kick inspect --json               # Output as JSON
```

| Flag | Description | Default |
|------|-------------|---------|
| `--port <port>` | Port of the running app to inspect | `3000` |
| `--watch` | Continuously re-inspect when the app reloads | `false` |
| `--json` | Output raw JSON instead of formatted tables | `false` |

Example output:

```
  KickJS Inspector — http://localhost:3000

  Routes (12):
    GET     /health
    GET     /api/users
    POST    /api/users
    GET     /api/users/:id
    PUT     /api/users/:id
    DELETE  /api/users/:id
    GET     /api/posts
    POST    /api/posts
    GET     /graphql          [GraphQLAdapter]
    WS      /chat             [WsAdapter]

  Adapters (3):
    GraphQLAdapter     /graphql
    WsAdapter          /chat
    DevToolsAdapter    /_debug

  Middleware (5):
    cors, helmet, csrf, rateLimit, session

  DI Container:
    Services:    8
    Controllers: 4
    Resolvers:   2
```

## Port Configuration

Port resolution order:

1. `-p` / `--port` CLI flag
2. `PORT` environment variable
3. `port` option in `bootstrap()` / `ApplicationOptions`
4. Default: `3000`

If the chosen port is in use, the server retries up to 3 times on consecutive ports (3001, 3002, etc.).

## kick.config.ts Reference

The `kick.config.ts` file at your project root controls CLI behavior, generators, and build steps. Generate one with `kick g config` or create it manually.

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'rest',
  modules: {
    dir: 'src/modules',
    repo: 'drizzle',
    pluralize: true,
    schemaDir: 'src/db/schema',
  },
  copyDirs: ['src/views', 'src/emails'],
  commands: [
    {
      name: 'db:migrate',
      description: 'Run database migrations',
      steps: 'npx drizzle-kit migrate',
    },
  ],
})
```

### `pattern`

Controls the default generator behavior and project template style.

| Value | Description |
|-------|-------------|
| `'rest'` | Express + Swagger (default) |
| `'ddd'` | Full DDD modules with use cases, entities, value objects |
| `'cqrs'` | CQRS with commands, queries, events + WS/queue |
| `'minimal'` | Bare Express with no scaffolding |

### `copyDirs`

Directories to copy into `dist/` after `kick build`. Useful for template files, email templates, static assets, and any non-TypeScript resources that Vite does not bundle.

Each entry can be a simple string (copied to the same relative path under `dist/`) or an object with explicit source and destination:

```ts
copyDirs: [
  'src/views',                              // copies to dist/src/views
  { src: 'src/views', dest: 'dist/views' }, // custom destination
  'src/emails',                             // copies to dist/src/emails
  'public/assets',                          // copies to dist/public/assets
]
```

If a source directory does not exist, the CLI logs a warning and skips it.

### `modules`

Module generation settings — controls how `kick g module` produces code.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `modules.dir` | `string` | `'src/modules'` | Where generators place module files |
| `modules.repo` | `string \| { name: string }` | `'inmemory'` | Default repository type. Built-in: `'drizzle'`, `'inmemory'`, `'prisma'`. Custom: `{ name: 'typeorm' }` |
| `modules.pluralize` | `boolean` | `true` | Whether to pluralize module folder and route names |
| `modules.schemaDir` | `string` | `undefined` | Schema output directory (e.g. `'src/db/schema'` or `'prisma/'`) |

### Other Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `plugins` | `KickCliPlugin[]` | `[]` | CLI plugins contributing commands, generators, and typegens (see [CLI Plugins](./cli-plugins.md)) |
| `commands` | `KickCommandDefinition[]` | `[]` | Project-local custom CLI commands (see [Custom Commands](./custom-commands.md)) |
| `style` | `object` | auto-detected | Code style overrides (`semicolons`, `quotes`, `trailingComma`, `indent`) |

::: details Deprecated top-level aliases
`modulesDir`, `defaultRepo`, `schemaDir`, and `pluralize` are still accepted at the top level for backward compatibility but are deprecated. Use the `modules` block instead.
:::

## Error Handling

All commands show help text after errors (`program.showHelpAfterError()`). The CLI loads `kick.config.ts` at startup to register custom commands before parsing arguments.
