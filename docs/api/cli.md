# @forinda/kickjs-cli

The `kick` binary — scaffolds projects, generates code, runs the dev server and typegen — plus a small programmatic API for `kick.config.ts`, CLI plugins, generators and doctor checks.

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

## Commands

Every command, flag and example lives in the [CLI Commands guide](../guide/cli-commands.md). The built-in top-level commands:

| Command                                       | Description                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `kick new [name]` (alias `init`)              | Create a project — `--template rest\|minimal\|fullstack\|inertia`, `--yes` |
| `kick dev` / `kick dev:debug`                 | Dev server with Vite HMR (`dev:debug` attaches the Node inspector)         |
| `kick build` / `kick build:assets`            | Production build via Vite / rebuild only the asset manifest                |
| `kick start`                                  | Start the production server                                                |
| `kick typecheck`                              | Type-check with the project's own `tsgo`/`tsc`                             |
| `kick generate <type> <name>` (alias `g`)     | Generators — run `kick g --list` for the full set                          |
| `kick remove module <names...>` (alias `rm`)  | Remove generated modules                                                   |
| `kick add [packages...]` / `kick list` (`ls`) | Install KickJS packages with their peers / list the catalog                |
| `kick typegen`                                | Generate `.kickjs/types/*`                                                 |
| `kick check` / `kick doctor`                  | Project audit / dev-environment pre-flight checks                          |
| `kick env example`                            | Write `.env.example` from the env schema and settings sections             |
| `kick codemod modules`                        | Rewrite module declarations between class and `defineModule` form          |
| `kick build:netlify` / `kick build:vercel`    | Bundle the serverless entry for Netlify / Vercel                           |
| `kick info` / `kick inspect [url]`            | System info / debug info from a running app                                |
| `kick explain [message]`                      | Explain a KickJS error and suggest a fix                                   |
| `kick tinker`                                 | REPL with the DI container and services loaded                             |
| `kick mcp [start\|init]`                      | Run the built app as an MCP server / write `.mcp.json`                     |

`kick db *` is not built in — it ships as `dbCliPlugin` from `@forinda/kickjs-db/cli`; add it to `plugins` in `kick.config.ts`.

## defineConfig

Identity helper that type-checks `kick.config.ts`.

```typescript
function defineConfig(config: KickConfig): KickConfig
```

## KickConfig

The `kick.config.ts` shape — configures the CLI, generators, typegen, build, deploy and `kick db`. It is **separate** from [`bootstrap()` options](./core.md#bootstrap-options), which configure the running app.

```typescript
interface KickConfig {
  pattern?: 'rest' | 'minimal' // generator scaffolding style
  runtime?: 'express' | 'fastify' | 'h3' // drives `kick add upload`, `kick doctor`, runtime typegen
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun' // overrides lockfile detection
  tokenScope?: string // DI token prefix for generated `createToken('<scope>/...')`

  modules?: {
    dir?: string // default: 'src/modules'
    /** @deprecated Only the stub's TODO text changes — see below. */
    repo?: 'inmemory' | { name: string } // default: 'inmemory'
    schemaDir?: string // e.g. 'src/db/schema'
    pluralize?: boolean // default: false
    style?: 'define' | 'class' // module declaration style (default: 'define')
  }

  typegen?: {
    srcDir?: string // default: 'src'
    outDir?: string // default: '.kickjs/types'
    schemaValidator?: 'zod' | 'kickjs-schema' | false // body-typing source (default: 'zod')
    envFile?: string | false // default: 'src/env.ts'; false disables env typing
    disable?: string[] // typegen plugin ids to skip, e.g. ['kick/runtime']
    client?: boolean | { enabled?: boolean; maxDepth?: number } // kick__client.d.ts route map, off by default
  }

  dev?: { typecheck?: boolean } // same as `kick dev --typecheck`
  build?: { outDir?: string }
  copyDirs?: Array<string | { src: string; dest?: string }> // copied to dist/ on build
  assetMap?: Record<
    string,
    { src: string; dest?: string; glob?: string; keys?: 'auto' | 'strip' | 'with-extension' }
  >

  db?: {
    schemaPath?: string // default: 'src/db/schema.ts'
    migrationsDir?: string // default: 'db/migrations'
    seedsDir?: string // default: 'db/seeds'
    dialect?: 'postgres' | 'sqlite' | 'mysql' // default: 'postgres'
    connectionString?: string // else DATABASE_URL
    adapter?: () => unknown | Promise<unknown> // escape hatch, wins over connectionString
  }

  deploy?: DeployConfig // `kick build:netlify` / `kick build:vercel`
  commands?: KickCommandDefinition[] // declarative `kick <name>` commands
  plugins?: KickCliPlugin[] // CLI plugins (e.g. dbCliPlugin)
  doctor?: DoctorExtension // extra `kick doctor` checks
  style?: {
    // generated-code style — NOT the module style (that is modules.style)
    semicolons?: boolean
    quotes?: 'single' | 'double'
    trailingComma?: 'all' | 'es5' | 'none'
    indent?: number
  }
}
```

`modules.repo`: `inmemory` is the only built-in and produces a working in-memory repository. Any other name (`{ name: 'postgres' }`) scaffolds the same unimplemented stub; the name only appears in its comments and "not implemented" errors.

```typescript
interface DeployConfig {
  entry?: string // default: 'src/serverless.ts'
  outDir?: string // default: 'dist/serverless'
  staticDir?: string | false // detected as ../web/dist in a fullstack workspace
  siteRoot?: string // where .netlify/ and .vercel/ are written
  publishDir?: string // default: 'dist/public'
  apiPath?: string // detected: '/api' with a frontend, '' API-only
  external?: string[] // default: ['valibot', 'yup']
  vercelRuntime?: string // default: 'nodejs22.x'
  include?: string[] // runtime files packaged with the function
}
```

## KickCommandDefinition

Declarative custom commands, via `kick.config.ts` `commands` or a plugin's `commands`.

```typescript
interface KickCommandDefinition {
  name: string // e.g. 'db:migrate'
  description: string
  steps: string | string[] // shell command(s), run in sequence; `{args}` = CLI arguments
  aliases?: string[]
}
```

## loadKickConfig / findProjectRoot

```typescript
function loadKickConfig(startDir: string): Promise<KickConfig | null>
function findProjectRoot(startDir?: string): string // walks up from cwd by default
```

## CLI plugins

```typescript
function defineCliPlugin(plugin: KickCliPlugin): KickCliPlugin

interface KickCliPlugin {
  name: string
  commands?: KickCommandDefinition[]
  register?: (program: Command, ctx: KickCliPluginContext) => void | Promise<void> // commander
  typegens?: TypegenPlugin[]
  generators?: GeneratorSpec[]
}

interface KickCliPluginContext {
  cwd: string
  projectRoot: string
  config: KickConfig | null
  log: (msg: string) => void
  generators?: DiscoveredGenerator[] // plugin-shipped generators merged by the host
}
```

Duplicate plugin, command, typegen or generator names throw `KickPluginConflictError` before any command runs. Guide: [CLI Plugins](../guide/cli-plugins.md).

### defineTypegen

```typescript
function defineTypegen(spec: TypegenPlugin): TypegenPlugin

interface TypegenPlugin {
  id: string
  inputs: string[]
  outExtension?: string
  generate(ctx: TypegenContext): Promise<string | null>
}
```

`TypegenContext` carries `cwd`, `config`, `importTs()`, `writeFile()`, `getScanResult()` and `log`. Guide: [Typegen](../guide/typegen.md).

### defineGenerator

```typescript
function defineGenerator(spec: GeneratorSpec): GeneratorSpec

interface GeneratorSpec {
  name: string
  description: string
  args?: readonly GeneratorArg[]
  flags?: readonly GeneratorFlag[]
  files(ctx: GeneratorContext): GeneratorFile[] | Promise<GeneratorFile[]>
}
```

`buildGeneratorContext()` builds a `GeneratorContext` for testing a generator outside the CLI. Guide: [Plugin Generators](../guide/plugin-generators.md).

## Doctor checks

```typescript
function defineDoctorCheck(check: DoctorCheck): DoctorCheck
function defineDoctorExtension(ext: DoctorExtension): DoctorExtension

type DoctorCheck = (
  ctx: DoctorContext, // { cwd, pkg, tsconfig, runtime }
) => DoctorResult | DoctorResult[] | null | Promise<DoctorResult | DoctorResult[] | null>

interface DoctorResult {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message?: string
  fix?: string
}

interface DoctorExtension {
  checks?: DoctorCheck[]
}
```

Plug them in through `doctor` in `kick.config.ts`. Guide: [kick doctor](../guide/cli-commands.md#kick-doctor).

## createTypegenDevWatcher

The typegen-on-save engine `kick dev` uses; [`@forinda/kickjs-vite`](./vite.md) consumes it so a plain `vite` boot gets the same watcher.

```typescript
function createTypegenDevWatcher(opts: {
  cwd: string
  config: KickConfig | null
  emitWarning: (message: string) => void
  onPassComplete?: () => void
  debounceMs?: number // default: 100
}): TypegenDevWatcher

interface TypegenDevWatcher {
  handleWatchEvent(event: 'add' | 'change' | 'unlink' | 'unlinkDir', file: string): void
  runOnce(): void
  assetSrcRoots: readonly string[]
  dispose(): void
}

const TYPEGEN_OWNER_KEY: '__kickjs_typegen_owner'
```

`TYPEGEN_OWNER_KEY` is the flag `kick dev` sets when it boots Vite itself, so the Vite plugin does not start a second watcher.

## Generator functions

The generators behind `kick g` and `kick new`, for use outside the CLI. Each `generate*` resolves to the list of written file paths.

```typescript
function generateModule(options: {
  name: string
  modulesDir: string
  noEntity?: boolean
  noTests?: boolean
  repo?: string
  minimal?: boolean
  force?: boolean
  pattern?: 'rest' | 'minimal'
  dryRun?: boolean
  pluralize?: boolean
  tokenScope?: string // default: 'app'
  swagger?: boolean
  schemaLib?: 'zod' | 'valibot' | 'yup'
  testHarness?: boolean
  style?: 'define' | 'class'
}): Promise<string[]>

function generateAdapter(options: { name: string; outDir: string }): Promise<string[]>

// generateMiddleware, generateGuard, generateService, generateController, generateDto
function generateService(options: {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: 'rest' | 'minimal'
  pluralize?: boolean
}): Promise<string[]>

function initProject(options: {
  name: string
  directory: string
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun' // default: 'pnpm'
  initGit?: boolean
  installDeps?: boolean
  template?: 'rest' | 'minimal' | 'inertia' // default: 'rest' (fullstack is composed by the CLI)
  runtime?: 'express' | 'fastify' | 'h3'
  schemaLib?: 'zod' | 'valibot' | 'yup'
  packages?: string[]
  // …plus workspace-internal options used by the fullstack template
}): Promise<{ builds: Record<string, boolean> }>
```

`generateMiddleware` also takes `runtime`, and `generateDto` takes `schemaLib`.

## Naming utilities

```typescript
function toPascalCase(str: string): string
function toCamelCase(str: string): string
function toKebabCase(str: string): string
function pluralize(str: string): string
```
