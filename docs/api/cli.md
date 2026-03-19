# @kickjs/cli

Command-line interface for scaffolding projects, generating code, and running the dev server.

## CLI Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `kick new <name>` | `kick init` | Create a new KickJS project |
| `kick dev` | | Start dev server with Vite HMR |
| `kick generate module <name>` | `kick g module` | Generate a full DDD module with all layers |
| `kick generate adapter <name>` | `kick g adapter` | Generate an AppAdapter scaffold |
| `kick generate middleware <name>` | `kick g middleware` | Generate an Express middleware function |
| `kick generate guard <name>` | `kick g guard` | Generate a route guard |
| `kick generate service <name>` | `kick g service` | Generate a `@Service()` class |
| `kick generate controller <name>` | `kick g controller` | Generate a `@Controller()` class with routes |
| `kick generate dto <name>` | `kick g dto` | Generate a Zod DTO schema |
| `kick info` | | Print system and framework info |

### Command Options

**kick new**
- `-d, --directory <dir>` -- Target directory (defaults to project name)
- `--pm <manager>` -- Package manager: `pnpm` | `npm` | `yarn` (default: `pnpm`)

**kick dev**
- `-e, --entry <file>` -- Entry file (default: `src/index.ts`)
- `-p, --port <port>` -- Port number

**kick g module**
- `--no-entity` -- Skip entity and value object generation
- `--no-tests` -- Skip test file generation
- `--repo <type>` -- Repository implementation: `inmemory` | `drizzle` (default: `inmemory`)
- `--minimal` -- Only generate index.ts and controller
- `--modules-dir <dir>` -- Modules directory (default: `src/modules`)

**kick g adapter / middleware / guard / service / controller / dto**
- `-o, --out <dir>` -- Output directory (defaults vary per generator)

## defineConfig

Helper to define a type-safe `kick.config.ts`.

```typescript
function defineConfig(config: KickConfig): KickConfig
```

## KickConfig

```typescript
interface KickConfig {
  modulesDir?: string                     // default: 'src/modules'
  defaultRepo?: 'drizzle' | 'inmemory' | 'prisma'
  schemaDir?: string
  commands?: KickCommandDefinition[]
  style?: {
    semicolons?: boolean
    quotes?: 'single' | 'double'
    trailingComma?: 'all' | 'es5' | 'none'
    indent?: number
  }
}
```

## KickCommandDefinition

Register custom CLI commands via `kick.config.ts`.

```typescript
interface KickCommandDefinition {
  name: string              // e.g. 'db:migrate'
  description: string
  steps: string | string[]  // shell command(s) to run
  aliases?: string[]
}
```

## Programmatic Exports

Generator functions for use outside the CLI.

```typescript
function generateModule(options: ModuleOptions): Promise<string[]>
function generateAdapter(options: { name: string; outDir: string }): Promise<string[]>
function generateMiddleware(options: { name: string; outDir: string }): Promise<string[]>
function generateGuard(options: { name: string; outDir: string }): Promise<string[]>
function generateService(options: { name: string; outDir: string }): Promise<string[]>
function generateController(options: { name: string; outDir: string }): Promise<string[]>
function generateDto(options: { name: string; outDir: string }): Promise<string[]>
function initProject(options: { name: string; directory: string; packageManager: string }): Promise<void>
function loadKickConfig(cwd: string): Promise<KickConfig | null>
```

## Naming Utilities

```typescript
function toPascalCase(str: string): string
function toCamelCase(str: string): string
function toKebabCase(str: string): string
function pluralize(str: string): string
```
