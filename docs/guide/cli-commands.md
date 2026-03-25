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
kick new my-app --git --install           # Non-interactive (defaults to rest template)
kick new my-app --no-git --no-install     # Skip git and install
kick new my-app -d ./custom-directory     # Custom target directory
kick new my-app -t graphql --pm pnpm --no-git --install  # Fully scriptable
```

All prompts are skippable via flags, making `kick new` usable in **CI pipelines and shell scripts**:

```bash
# Fully non-interactive — no TTY required
kick new my-api --template rest --pm pnpm --no-git --install
```

When run without flags, the CLI prompts for:
1. **Project template** — REST, GraphQL, DDD, Microservice, or Minimal
2. **Package manager** — pnpm, npm, or yarn
3. **Default repository** — Prisma, Drizzle, In-Memory, or Custom ORM
4. **Git init** — initialize a git repository with an initial commit
5. **Install deps** — run the selected package manager's install command

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --template <type>` | Project template: `rest`, `graphql`, `ddd`, `cqrs`, `minimal` | Prompted |
| `-d, --directory <dir>` | Target directory | Project name |
| `--pm <manager>` | Package manager: `pnpm`, `npm`, or `yarn` | Prompted |
| `--git / --no-git` | Initialize git repository | Prompted |
| `--install / --no-install` | Install dependencies | Prompted |
| `-f, --force` | Clear non-empty directory without prompting | `false` |

### Templates

| Template | Adapters | Initial deps |
|----------|----------|-------------|
| `rest` (default) | Swagger + DevTools | core, http, config, swagger |
| `graphql` | GraphQLAdapter + DevTools | core, http, graphql |
| `ddd` | Swagger + DevTools | core, http, config, swagger |
| `cqrs` | Swagger + OTel + WS + DevTools | core, http, swagger, otel, ws, queue |
| `minimal` | None | core, http |

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

## kick list

List all available KickJS packages. Alias: `kick ls`.

```bash
kick list
kick ls
```

Output shows each package name, description, and required peer dependencies:

```
  Available KickJS packages:

    core            DI container, decorators, reactivity
    http            Express 5, routing, middleware
    config          Zod-based env validation
    cli             CLI tool and code generators
    swagger         OpenAPI spec + Swagger UI + ReDoc
    graphql         GraphQL resolvers + GraphiQL (+ graphql)
    drizzle         Drizzle ORM adapter + query builder (+ drizzle-orm)
    prisma          Prisma adapter + query builder (+ @prisma/client)
    ws              WebSocket with @WsController decorators (+ socket.io)
    otel            OpenTelemetry tracing + metrics (+ @opentelemetry/api)
    devtools        Development dashboard — routes, DI, metrics, health
    auth            Authentication — JWT, API key, and custom strategies (+ jsonwebtoken)
    mailer          Email sending — SMTP, Resend, SES, or custom provider (+ nodemailer)
    cron            Cron job scheduling (+ croner)
    queue           Queue adapter (BullMQ/RabbitMQ/Kafka)
    queue:bullmq    Queue with BullMQ + Redis (+ bullmq, ioredis)
    queue:rabbitmq  Queue with RabbitMQ (+ amqplib)
    queue:kafka     Queue with Kafka (+ kafkajs)
    multi-tenant    Tenant resolution middleware
    notifications   Multi-channel notifications — email, Slack, Discord, webhook
    testing         Test utilities and TestModule builder
```

## kick add

Add KickJS packages with their required peer dependencies automatically resolved.

```bash
kick add graphql          # installs @forinda/kickjs-graphql + graphql
kick add drizzle otel     # installs multiple packages at once
kick add queue:bullmq     # installs queue package + bullmq + ioredis
kick add --list           # show all available packages (same as kick list)
```

| Flag | Description |
|------|-------------|
| `--pm <manager>` | Package manager override (auto-detected from lockfile) |
| `-D, --dev` | Install as dev dependency |
| `--list` | List all available packages (same as `kick list`) |

## kick generate (kick g)

Generate code scaffolds. See the [Generators](./generators.md) page for full details.

```bash
kick g --list            # List all available generators
kick g module user       # Structure depends on pattern in kick.config.ts
kick g module user --pattern rest  # Force flat REST structure
kick g resolver product  # GraphQL resolver with @Query/@Mutation/@Arg
kick g job email         # Queue job processor with @Job/@Process
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
| `--repo <type>` | Default repository type: `inmemory`, `drizzle`, or `prisma` | `inmemory` |

If `kick.config.ts` already exists, the CLI prompts for confirmation before overwriting.

## Custom Commands

Project-specific commands defined in `kick.config.ts` appear alongside built-in commands. See [Custom Commands](./custom-commands.md) for details.

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
| `'graphql'` | GraphQL + GraphiQL |
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
| `commands` | `KickCommandDefinition[]` | `[]` | Custom CLI commands (see [Custom Commands](./custom-commands.md)) |
| `style` | `object` | auto-detected | Code style overrides (`semicolons`, `quotes`, `trailingComma`, `indent`) |

::: details Deprecated top-level aliases
`modulesDir`, `defaultRepo`, `schemaDir`, and `pluralize` are still accepted at the top level for backward compatibility but are deprecated. Use the `modules` block instead.
:::

## Error Handling

All commands show help text after errors (`program.showHelpAfterError()`). The CLI loads `kick.config.ts` at startup to register custom commands before parsing arguments.
