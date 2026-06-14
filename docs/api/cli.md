# @forinda/kickjs-cli

Command-line interface for scaffolding projects, generating code, and running the dev server.

## Installation

```bash
# Global install
pnpm add -g @forinda/kickjs-cli

# Or use npx
npx @forinda/kickjs-cli new my-api
```

### Link local build (for contributors)

```bash
pnpm build
cd packages/cli && pnpm link --global
```

`kick` now points to your local build. Re-run `pnpm build` after changes.

## CLI Commands

| Command                                     | Alias                                          | Description                                                                       |
| ------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `kick new <name>`                           | `kick init`                                    | Create a new KickJS project                                                       |
| `kick dev`                                  |                                                | Start dev server with Vite HMR                                                    |
| `kick list`                                 | `kick ls`                                      | List all available KickJS packages                                                |
| `kick add <packages...>`                    |                                                | Install KickJS packages with peer deps                                            |
| `kick generate --list`                      | `kick g --list`                                | List all available generators                                                     |
| `kick generate module <name>`               | `kick g module`                                | Generate a full DDD module with all layers                                        |
| `kick generate scaffold <name> <fields...>` | `kick g scaffold`                              | CRUD module from field definitions (`name:type:optional`)                         |
| `kick generate adapter <name>`              | `kick g adapter`                               | Generate an AppAdapter scaffold                                                   |
| `kick generate middleware <name>`           | `kick g middleware`                            | Generate an Express middleware function                                           |
| `kick generate guard <name>`                | `kick g guard`                                 | Generate a route guard                                                            |
| `kick generate service <name>`              | `kick g service`                               | Generate a `@Service()` class                                                     |
| `kick generate controller <name>`           | `kick g controller`                            | Generate a `@Controller()` class with routes                                      |
| `kick generate dto <name>`                  | `kick g dto`                                   | Generate a Zod DTO schema                                                         |
| `kick generate resolver <name>`             | `kick g resolver`                              | Generate a GraphQL `@Resolver` class                                              |
| `kick generate job <name>`                  | `kick g job`                                   | Generate a `@Job` queue processor                                                 |
| `kick generate test <name>`                 | `kick g test`                                  | Generate a Vitest test scaffold                                                   |
| `kick generate config`                      | `kick g config`                                | Generate `kick.config.ts`                                                         |
| `kick generate agents`                      | `kick g agents` (also `agent-docs`, `ai-docs`) | Regenerate `AGENTS.md` / `CLAUDE.md` / `kickjs-skills.md` from upstream templates |
| `kick info`                                 |                                                | Print system and framework info                                                   |
| `kick inspect`                              |                                                | Inspect a running KickJS application                                              |
| `kick tinker`                               |                                                | Interactive REPL                                                                  |

### Command Options

**kick new [name]** (use `.` for current directory)

- `-d, --directory <dir>` -- Target directory (defaults to project name)
- `--pm <manager>` -- Package manager: `pnpm` | `npm` | `yarn` (prompted if omitted)
- `--git / --no-git` -- Initialize git repository (prompted if omitted)
- `--install / --no-install` -- Install dependencies (prompted if omitted)

**kick dev**

- `-e, --entry <file>` -- Entry file (default: `src/index.ts`)
- `-p, --port <port>` -- Port number
- `--polling` -- Force chokidar polling (Docker bind mounts / WSL / NFS)
- `--typecheck` -- Run the project's checker (`tsgo`/`tsc --noEmit`) after each change; also via `dev.typecheck` in kick.config

**kick g module**

- `--pattern <type>` -- Module structure: `rest` | `ddd` | `cqrs` | `minimal` (default: from config or `ddd`)
- `--no-entity` -- Skip entity and value object generation (DDD only)
- `--no-tests` -- Skip test file generation
- `--repo <type>` -- Repository implementation: `inmemory` | `drizzle` | `prisma` (default: from config or `inmemory`)
- `--minimal` -- Shorthand for `--pattern minimal`
- `--modules-dir <dir>` -- Modules directory (default: from config or `src/modules`)
- `-f, --force` -- Overwrite existing files without prompting

**kick g controller / service / dto / guard / middleware**

- `-o, --out <dir>` -- Output directory (overrides `--module`)
- `-m, --module <name>` -- Place inside a module's DDD folder structure

**kick g adapter / resolver / job**

- `-o, --out <dir>` -- Output directory (defaults vary per generator)

**kick g agents** (aliases: `kick g agent-docs`, `kick g ai-docs`)

- `--only <which>` -- Scope: `agents` | `claude` | `skills` | `both` | `all` (default: `all`)
- `--name <name>` -- Project name override (default: from `package.json`)
- `--pm <pm>` -- Package manager override (default: from corepack `packageManager` field)
- `--template <template>` -- Template: `rest` | `graphql` | `ddd` | `cqrs` | `minimal` (default: from `kick.config.ts` `pattern`)
- `-f, --force` -- Overwrite without prompting

## defineConfig

Helper to define a type-safe `kick.config.ts`.

```typescript
function defineConfig(config: KickConfig): KickConfig
```

## KickConfig

The `kick.config.ts` shape — configures the CLI, code generators, typegen, and `kick db`. It is **separate** from [`bootstrap()` options](./core.md#bootstrap-options), which configure the running app. Wrap it in [`defineConfig`](#defineconfig) for type-checking.

```typescript
interface KickConfig {
  pattern?: 'rest' | 'ddd' | 'cqrs' | 'minimal' // generator scaffolding style
  runtime?: 'express' | 'fastify' | 'h3' // HTTP engine — drives `kick add upload`, `kick doctor`, runtime typegen
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun' // overrides lockfile auto-detection for `kick add`
  tokenScope?: string // DI token prefix for generated `createToken('<scope>/...')`

  modules?: {
    dir?: string // default: 'src/modules'
    repo?: 'inmemory' | 'prisma' | 'drizzle' | { name: string } // default: 'inmemory'
    pluralize?: boolean // default: true
    schemaDir?: string // Drizzle/Prisma schema files
    prismaClientPath?: string // Prisma 7: '@/generated/prisma/client'
  }

  typegen?: {
    srcDir?: string // default: 'src'
    outDir?: string // default: '.kickjs/types'
    schemaValidator?: 'kickjs-schema' | 'zod' | false // body-typing source
    envFile?: string | false // false disables env typing
    disable?: string[] // plugin ids to skip, e.g. ['kick/runtime']
  }

  db?: {
    schemaPath?: string // default: 'src/db/schema.ts'
    migrationsDir?: string // default: 'db/migrations'
    dialect?: 'postgres' | 'sqlite' | 'mysql' // default: 'postgres'
    connectionString?: string // else read from DATABASE_URL
    adapter?: () => unknown | Promise<unknown> // escape hatch (takes precedence)
  }

  copyDirs?: Array<string | { src: string; dest?: string }> // dirs copied to dist/ on build
  commands?: KickCommandDefinition[] // custom `kick <name>` commands
  plugins?: KickCliPlugin[] // CLI plugins (e.g. dbCliPlugin from '@forinda/kickjs-db/cli')
  doctor?: { checks?: DoctorCheck[] } // extra `kick doctor` checks
  style?: 'define' | 'class' // module generation style
}
```

Key fields at a glance:

| Field                  | Default                                    | Used by                                                           |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `pattern`              | `'rest'`                                   | `kick new`, `kick g`                                              |
| `runtime`              | `'express'`                                | `kick add upload` (driver), `kick doctor`, `kick/runtime` typegen |
| `packageManager`       | lockfile-detected                          | `kick add` and any dep-installing command                         |
| `modules`              | see above                                  | module generators                                                 |
| `typegen`              | `srcDir: 'src'`, `outDir: '.kickjs/types'` | `kick typegen`, `kick dev`                                        |
| `db`                   | `dialect: 'postgres'`                      | `kick db *` (when `dbCliPlugin` is in `plugins`)                  |
| `commands` / `plugins` | `[]`                                       | custom CLI surface                                                |
| `doctor`               | —                                          | `kick doctor`                                                     |

> The deprecated top-level `modulesDir` / `defaultRepo` / `pluralize` / `schemaDir` fields still parse but are superseded by the `modules` block — migrate to `modules.*`.

## KickCommandDefinition

Register custom CLI commands via `kick.config.ts`.

```typescript
interface KickCommandDefinition {
  name: string // e.g. 'db:migrate'
  description: string
  steps: string | string[] // shell command(s) to run
  aliases?: string[]
}
```

## Programmatic Exports

Generator functions for use outside the CLI.

```typescript
function generateModule(options: ModuleOptions): Promise<string[]>
function generateScaffold(options: ScaffoldOptions): Promise<string[]>
function generateAdapter(options: { name: string; outDir: string }): Promise<string[]>
function generateMiddleware(options: { name: string; outDir: string }): Promise<string[]>
function generateGuard(options: { name: string; outDir: string }): Promise<string[]>
function generateService(options: { name: string; outDir: string }): Promise<string[]>
function generateController(options: { name: string; outDir: string }): Promise<string[]>
function generateDto(options: { name: string; outDir: string }): Promise<string[]>
function generateResolver(options: { name: string; outDir: string }): Promise<string[]>
function generateJob(options: { name: string; outDir: string; queue?: string }): Promise<string[]>
function generateConfig(options: ConfigOptions): Promise<string[]>
function initProject(options: {
  name: string
  directory: string
  packageManager: string
}): Promise<void>
function loadKickConfig(cwd: string): Promise<KickConfig | null>
```

### RepoType

```typescript
type RepoType = 'drizzle' | 'inmemory' | 'prisma'
```

## Naming Utilities

```typescript
function toPascalCase(str: string): string
function toCamelCase(str: string): string
function toKebabCase(str: string): string
function pluralize(str: string): string
```
