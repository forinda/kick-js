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
kick new my-app --yes                    # Pick all defaults (rest + inmemory)
kick new my-app --yes --template minimal # Minimal template, no prompts
kick new .                               # Scaffold in current directory
kick new my-app --pm pnpm                # Skip PM prompt only
kick new my-app -t rest --pm pnpm --no-git --install  # Fully scriptable
```

`-y, --yes` (alias `--non-interactive`) bypasses every prompt and picks safe defaults — usable in CI pipelines and one-liner shell scripts:

```bash
# Single-flag fully non-interactive — no TTY required
kick new my-api --yes
```

`--yes` defaults:

| Setting           | Default value                                                                         |
| ----------------- | ------------------------------------------------------------------------------------- |
| Template          | `rest`                                                                                |
| Repository        | `inmemory`                                                                            |
| Optional packages | none                                                                                  |
| Git init          | enabled                                                                               |
| Install deps      | enabled                                                                               |
| Package manager   | resolved via `kick add`'s chain (config → corepack `packageManager` → lockfile → npm) |

Any explicit flag overrides the matching default — `--yes --template minimal --repo postgres` scaffolds a minimal project with a `postgres` custom-repository stub without prompts.

When run without `--yes` (and without specific flags), the CLI prompts for:

1. **Project template** — REST, Minimal, or Fullstack (server + typed web app)
2. **Package manager** — pnpm, npm, yarn, or bun
3. **Default repository** — In-Memory or a custom DB name (e.g. `postgres`, `mongo`)
4. **Optional packages** — auth, swagger, ws, queue, devtools
5. **Git init** — initialize a git repository with an initial commit
6. **Install deps** — run the selected package manager's install command

| Flag                             | Description                                                            | Default                                  |
| -------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| `-t, --template <type>`          | Project template: `rest`, `minimal`, `fullstack`                       | Prompted (or `rest` with `--yes`)        |
| `-r, --repo <name>`              | Repository name: `inmemory` (default) or any DB name (e.g. `postgres`) | Prompted (or `inmemory` with `--yes`)    |
| `-d, --directory <dir>`          | Target directory                                                       | Project name                             |
| `--pm <manager>`                 | Package manager: `pnpm`, `npm`, `yarn`, or `bun`                       | Prompted (or auto-detected with `--yes`) |
| `--packages <list>`              | Comma-separated optional packages                                      | Prompted (or none with `--yes`)          |
| `--git / --no-git`               | Initialize git repository                                              | Prompted (or `true` with `--yes`)        |
| `--install / --no-install`       | Install dependencies                                                   | Prompted (or `true` with `--yes`)        |
| `-f, --force`                    | Clear non-empty directory without prompting                            | `false`                                  |
| `-y, --yes`, `--non-interactive` | Bypass every prompt with safe defaults                                 | `false`                                  |

### Templates

| Template         | Adapters           | Packages installed                                             |
| ---------------- | ------------------ | -------------------------------------------------------------- |
| `rest` (default) | Swagger + DevTools | kickjs, kickjs-vite, kickjs-swagger                            |
| `minimal`        | None               | kickjs, kickjs-vite                                            |
| `fullstack`      | None (minimal API) | server: kickjs, kickjs-vite · web: kickjs-client, React + Vite |

`fullstack` scaffolds a pnpm workspace — `server/` (KickJS API) + `web/`
(Vite + React typed against the API via the
[typed client](./typed-client.md)); `pnpm dev` runs both.

Use `.` as the project name to scaffold in the current directory (the folder name becomes the project name).

The `init` alias also works: `kick init my-app`.

**Non-empty directory safety:** If the target directory already contains files, the CLI shows up to 5 existing entries and asks for confirmation before clearing them. Use `--force` to skip the prompt. Running with `--yes` _without_ `--force` aborts cleanly when the directory is non-empty — the non-interactive flag never silently destroys existing work.

## kick dev

Start the development server with Vite HMR:

```bash
kick dev
kick dev -e src/main.ts
kick dev -p 4000
```

| Flag                 | Description                                                                         | Default                |
| -------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| `-e, --entry <file>` | Entry file                                                                          | `src/index.ts`         |
| `-p, --port <port>`  | Port number                                                                         | `3000` (or `PORT` env) |
| `--polling`          | Force chokidar polling (Docker bind mounts / WSL / NFS where fs events get dropped) | off                    |
| `--typecheck`        | Run the project's TypeScript checker after each change (see below)                  | off                    |

Changes to your source files are picked up instantly — database connections, WebSocket state, and port bindings survive reloads.

### Errors surface on save

`kick dev` reports problems the moment a save lands, without waiting for a request:

- **Runtime/transform errors** — a broken file (syntax error, failed import, bootstrap throw) prints `[kickjs] app failed to reload after HMR invalidation: …` with a fixed stacktrace.
- **Typegen failures** — a scan or plugin pass that fails prints a deduplicated `kick typegen: … — types in .kickjs/types may be stale` warning (quiet on repeats of the same error; re-arms after a successful pass) and broadcasts a `kickjs:typegen-error` custom HMR event for DevTools/overlays.

### `--typecheck` — dev-time type checking

Opt in via the flag or `dev: { typecheck: true }` in `kick.config.ts`. After each debounced change (and once at startup), `kick dev` runs the **project's own** checker — `tsgo` (`@typescript/native-preview`) preferred, `tsc` fallback — with `--noEmit`, timed after the typegen pass so diagnostics always see fresh `.kickjs/types`:

```text
  kick typecheck (tsgo, 412ms):
    src/modules/users/users.controller.ts(14,9): error TS2322: …
```

A healthy project stays quiet; the first clean run after an error prints `kick typecheck: clean again`. In-flight checks are killed when a new save lands, and the full output rides the `kickjs:typecheck` HMR event.

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

| Flag                 | Description | Default                |
| -------------------- | ----------- | ---------------------- |
| `-e, --entry <file>` | Entry file  | `dist/index.js`        |
| `-p, --port <port>`  | Port number | `3000` (or `PORT` env) |

Sets `NODE_ENV=production` automatically.

## kick doctor

Pre-flight checks for your KickJS project's dev environment. Catches the common "doesn't work on my machine" misconfigs before they bite — missing decorator flags, env-wiring footguns, stale typegen, wrong Node version.

```bash
kick doctor
```

Sibling to `kick check --deploy` (which scans for production-readiness — JWT secrets, CORS, rate limits, etc.). Doctor is the dev-setup counterpart.

Sample output:

```text
KickJS Doctor

✔  Node version  (v22.7.0)
✔  @forinda/kickjs installed  (^5.12.0)
✔  express installed  (^5.1.0)
✔  reflect-metadata installed  (^0.2.2)
✔  tsconfig: experimentalDecorators
✔  tsconfig: emitDecoratorMetadata
⚠  env wiring  (env-init imported AFTER bootstrap() — should be before)
   → Move the env import above the bootstrap() call so the schema
   → runs before any service reads from ConfigService.
✔  typegen freshness  (2m ago)

8 passed, 1 warning, 0 errors — review the warnings
```

Exit code is `0` on pass-or-warn, `1` on any error.

### What it checks

| Check                              | Severity if failing | Detects                                                                                                    |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Node version                       | error               | Node version below the framework's minimum (20+)                                                           |
| `@forinda/kickjs` installed        | error               | Wrong directory, or fresh repo without `kick new`                                                          |
| `express` installed                | error               | Required peer dep missing (`@forinda/kickjs`'s peer)                                                       |
| `reflect-metadata` installed       | error               | Decorator runtime polyfill missing                                                                         |
| tsconfig: `experimentalDecorators` | error               | Decorators won't compile                                                                                   |
| tsconfig: `emitDecoratorMetadata`  | error               | DI container can't read constructor types                                                                  |
| env wiring                         | error / warn        | env-init file calls `loadEnv(...)` but the app entry doesn't import it (or imports it AFTER `bootstrap()`) |
| typegen freshness                  | warn                | `.kickjs/types/` last touched > 60 minutes ago                                                             |

The env-wiring check looks at multiple common locations — `src/env.ts`, `src/env/index.ts`, `src/config/env.ts`, `src/config/index.ts` — and accepts both relative and `@/` aliased imports.

### Extending with custom checks

Add your own checks via `kick.config.ts`. Adopter-supplied checks run after the built-ins and use the same `DoctorContext` / `DoctorResult` shape. The CLI exports `defineDoctorExtension` and `defineDoctorCheck` as identity helpers — they give you type inference and autocomplete without an explicit type annotation, mirroring the `defineConfig` pattern.

#### Inline — quickest path

```ts
// kick.config.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, defineDoctorExtension } from '@forinda/kickjs-cli'

export default defineConfig({
  doctor: defineDoctorExtension({
    checks: [
      // Project-specific: only emits a result when this project has migrations
      (ctx) => {
        if (!existsSync(join(ctx.cwd, 'migrations'))) return null
        const applied = join(ctx.cwd, '.migrations-applied')
        return existsSync(applied)
          ? { name: 'Migrations applied', status: 'pass' }
          : {
              name: 'Migrations applied',
              status: 'fail',
              fix: 'Run: kick db migrate',
            }
      },
    ],
  }),
})
```

#### Shared extension — published or workspace-shared

When you want the same extension across multiple projects in a monorepo (or want to publish it as a package), put the extension in its own module:

```ts
// doctor-checks/migrations.ts
import { defineDoctorExtension } from '@forinda/kickjs-cli'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const migrationsDoctor = defineDoctorExtension({
  checks: [
    (ctx) => {
      if (!existsSync(join(ctx.cwd, 'migrations'))) return null
      const applied = join(ctx.cwd, '.migrations-applied')
      return existsSync(applied)
        ? { name: 'Migrations applied', status: 'pass' }
        : {
            name: 'Migrations applied',
            status: 'fail',
            fix: 'Run: kick db migrate',
          }
    },
  ],
})
```

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { migrationsDoctor } from './doctor-checks/migrations'

export default defineConfig({
  doctor: migrationsDoctor,
})
```

#### Single-check helper

For one-off checks scattered across modules, `defineDoctorCheck` provides the same type-inference convenience:

```ts
import { defineDoctorCheck } from '@forinda/kickjs-cli'

export const checkJwtSecretLength = defineDoctorCheck((ctx) => {
  const v = process.env.JWT_SECRET
  if (!v || v.length < 32) {
    return {
      name: 'JWT_SECRET ≥ 32 chars',
      status: 'warn',
      fix: 'Generate a strong secret: openssl rand -hex 32',
    }
  }
  return { name: 'JWT_SECRET ≥ 32 chars', status: 'pass' }
})
```

The framework stays ORM-agnostic on purpose — database- or ORM-specific checks belong in adopter config (or in adapter packages that ship doctor extensions), never in core.

## kick info

Print system and framework information:

```bash
kick info
```

Output — the CLI's own version, plus every `@forinda/kickjs*` dependency the nearest project declares with the version actually installed in `node_modules` (declared range shown when not installed). Packages the `kick add` catalog marks as deprecated are flagged:

```text
  KickJS CLI v6.1.0

  System:
    OS:       linux 6.x.x (x64)
    Node:     v22.x.x

  Packages:
    @forinda/kickjs          5.16.0
    @forinda/kickjs-cli      6.1.0
    @forinda/kickjs-prisma   6.0.1  [DEPRECATED — see `kick add --list --all`]
    @forinda/kickjs-vite     6.1.0
```

`kick --version` / `-V` / `-v` print just the CLI version.

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
kick add db ai            # installs multiple packages at once
kick add queue:bullmq     # installs queue package + bullmq + ioredis
kick add --list           # show core packages (alias: kick list)
kick add --list --all     # full optional catalog
```

Deprecated catalog entries (`auth`, `drizzle`, `prisma`) still install but print a migration warning first, and `--list --all` flags them with `[DEPRECATED — …]` plus the recommended replacement (BYO auth via context decorators; `@forinda/kickjs-db` for the early-adoption ORM adapters).

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

The framework runtime (`@forinda/kickjs`), the dev/build/HMR layer (`@forinda/kickjs-vite`), and the CLI (`@forinda/kickjs-cli`) are the only members of the core set. Everything else — auth, swagger, db, ws, queue, devtools, mcp, testing — is opt-in via `kick add`.

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

| Flag             | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `--pm <manager>` | Package manager override (auto-detected via the chain above) |
| `-D, --dev`      | Install as dev dependency                                    |
| `--list`         | List packages (core only by default)                         |
| `--all`          | When paired with `--list`, include the full optional catalog |

## kick generate (kick g)

Generate code scaffolds. See the [Generators](./generators.md) page for full details.

```bash
kick g --list            # List all available generators
kick g module user       # Structure depends on pattern in kick.config.ts
kick g module user --pattern rest  # Force flat REST structure
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

| Type         | TypeScript          | Zod                     | Example                       |
| ------------ | ------------------- | ----------------------- | ----------------------------- |
| `string`     | `string`            | `z.string()`            | `title:string`                |
| `text`       | `string`            | `z.string()`            | `body:text`                   |
| `number`     | `number`            | `z.number()`            | `price:number`                |
| `int`        | `number`            | `z.number().int()`      | `age:int`                     |
| `float`      | `number`            | `z.number()`            | `rating:float`                |
| `boolean`    | `boolean`           | `z.boolean()`           | `active:boolean`              |
| `date`       | `string`            | `z.string().datetime()` | `createdAt:date`              |
| `email`      | `string`            | `z.string().email()`    | `email:email`                 |
| `url`        | `string`            | `z.string().url()`      | `website:url`                 |
| `uuid`       | `string`            | `z.string().uuid()`     | `externalId:uuid`             |
| `json`       | `any`               | `z.any()`               | `metadata:json`               |
| `enum:a,b,c` | `'a' \| 'b' \| 'c'` | `z.enum(['a','b','c'])` | `status:enum:draft,published` |

#### Scaffold Flags

| Flag                  | Description               | Default       |
| --------------------- | ------------------------- | ------------- |
| `--no-tests`          | Skip test file generation | `false`       |
| `--no-pluralize`      | Use singular names        | from config   |
| `--repo <name>`       | Repository name           | from config   |
| `--modules-dir <dir>` | Modules directory         | `src/modules` |

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
kick g config --repo postgres        # Default repo name
```

| Flag                  | Description                                                            | Default       |
| --------------------- | ---------------------------------------------------------------------- | ------------- |
| `-f, --force`         | Overwrite existing config without prompting                            | `false`       |
| `--modules-dir <dir>` | Modules directory path                                                 | `src/modules` |
| `--repo <name>`       | Repository name: `inmemory` (default) or any DB name (e.g. `postgres`) | `inmemory`    |

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

| Flag                    | Description                                         | Default               |
| ----------------------- | --------------------------------------------------- | --------------------- |
| `--only <which>`        | `agents` \| `claude` \| `skills` \| `both` \| `all` | `all`                 |
| `--name <name>`         | Project name override                               | from `package.json`   |
| `--pm <pm>`             | Package manager override                            | from `package.json`   |
| `--template <template>` | `rest` \| `minimal`                                 | from `kick.config.ts` |
| `-f, --force`           | Overwrite without prompting                         | `false`               |

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

| Flag            | Description                                  | Default |
| --------------- | -------------------------------------------- | ------- |
| `--port <port>` | Port of the running app to inspect           | `3000`  |
| `--watch`       | Continuously re-inspect when the app reloads | `false` |
| `--json`        | Output raw JSON instead of formatted tables  | `false` |

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
    WS      /chat             [WsAdapter]

  Adapters (2):
    WsAdapter          /chat
    DevToolsAdapter    /_debug

  Middleware (5):
    cors, helmet, csrf, rateLimit, session

  DI Container:
    Services:    8
    Controllers: 4
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
    repo: { name: 'postgres' },
    pluralize: true,
    schemaDir: 'src/db/schema',
  },
  copyDirs: ['src/views', 'src/emails'],
  commands: [
    {
      name: 'db:migrate',
      description: 'Run database migrations',
      steps: 'kick db migrate',
    },
  ],
})
```

### `pattern`

Controls the default generator behavior and project template style.

| Value       | Description                                                 |
| ----------- | ----------------------------------------------------------- |
| `'rest'`    | Express + Swagger, flat module layout (default)             |
| `'minimal'` | Bare Express with no scaffolding (module + controller only) |

(`kick new` additionally offers the `fullstack` workspace template — it scaffolds
a `rest`/`minimal`-style server plus a typed web app; the `pattern` config above
applies to the server side.)

### `copyDirs`

Directories to copy into `dist/` after `kick build`. Useful for template files, email templates, static assets, and any non-TypeScript resources that Vite does not bundle.

Each entry can be a simple string (copied to the same relative path under `dist/`) or an object with explicit source and destination:

```ts
copyDirs: [
  'src/views', // copies to dist/src/views
  { src: 'src/views', dest: 'dist/views' }, // custom destination
  'src/emails', // copies to dist/src/emails
  'public/assets', // copies to dist/public/assets
]
```

If a source directory does not exist, the CLI logs a warning and skips it.

### `modules`

Module generation settings — controls how `kick g module` produces code.

| Option              | Type                         | Default         | Description                                                                                                                                               |
| ------------------- | ---------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules.dir`       | `string`                     | `'src/modules'` | Where generators place module files                                                                                                                       |
| `modules.repo`      | `string \| { name: string }` | `'inmemory'`    | Repository name. Built-in: `'inmemory'` (working in-memory impl). Any other name (e.g. `{ name: 'postgres' }`) scaffolds a generic custom-repository stub |
| `modules.pluralize` | `boolean`                    | `true`          | Whether to pluralize module folder and route names                                                                                                        |
| `modules.schemaDir` | `string`                     | `undefined`     | Schema output directory (e.g. `'src/db/schema'`)                                                                                                          |

### Other Options

| Option     | Type                      | Default       | Description                                                                                       |
| ---------- | ------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `plugins`  | `KickCliPlugin[]`         | `[]`          | CLI plugins contributing commands, generators, and typegens (see [CLI Plugins](./cli-plugins.md)) |
| `commands` | `KickCommandDefinition[]` | `[]`          | Project-local custom CLI commands (see [Custom Commands](./custom-commands.md))                   |
| `style`    | `object`                  | auto-detected | Code style overrides (`semicolons`, `quotes`, `trailingComma`, `indent`)                          |

::: details Deprecated top-level aliases
`modulesDir`, `defaultRepo`, `schemaDir`, and `pluralize` are still accepted at the top level for backward compatibility but are deprecated. Use the `modules` block instead.
:::

## Error Handling

All commands show help text after errors (`program.showHelpAfterError()`). The CLI loads `kick.config.ts` at startup to register custom commands before parsing arguments.
