type ProjectTemplate = 'rest' | 'minimal' | 'fullstack'

/** Generate README.md with project documentation */
export function generateReadme(name: string, template: ProjectTemplate, pm: string): string {
  const templateLabels: Record<string, string> = {
    rest: 'REST API',
    minimal: 'Minimal',
    fullstack: 'Fullstack (KickJS API + typed web app)',
  }

  const packages = ['@forinda/kickjs', '@forinda/kickjs-vite']
  if (template !== 'minimal') {
    packages.push('@forinda/kickjs-swagger', '@forinda/kickjs-devtools')
  }

  return `# ${name}

A **${templateLabels[template] ?? 'REST API'}** built with [KickJS](https://kickjs.app/) — a decorator-driven Node.js framework for TypeScript that runs on Express, Fastify, or h3 (swap the engine in one line).

## Getting Started

\`\`\`bash
${pm} install
kick dev
\`\`\`

## Scripts

| Command | Description |
|---|---|
| \`kick dev\` | Start dev server with Vite HMR |
| \`kick build\` | Production build |
| \`kick start\` | Run production build |
| \`${pm} run test\` | Run tests with Vitest |
| \`kick g module <name>\` | Generate a DDD module |
| \`kick g scaffold <name> <fields...>\` | Generate CRUD from field definitions |
| \`kick add <package>\` | Add a KickJS package |

## Project Structure

\`\`\`
src/
├── index.ts           # Application entry point
├── modules/           # Feature modules (controllers, services, repos)
│   └── index.ts       # Module registry
└── ...
\`\`\`

## Packages

${packages.map((p) => `- \`${p}\``).join('\n')}

## Adding Features

\`\`\`bash
kick add auth          # Authentication (JWT, API key, OAuth)
kick add swagger       # OpenAPI documentation
kick add ws            # WebSocket support
kick add queue         # Background job processing
kick add --list        # Show all available packages
\`\`\`

For email, scheduled tasks, multi-tenancy, OpenTelemetry, GraphQL, and notifications use the BYO recipes in the [KickJS guides](https://kickjs.app/guide/) — they wire the upstream library through \`defineAdapter()\` / \`definePlugin()\` directly, so you keep control of the integration.

## Environment Variables

Copy \`.env.example\` to \`.env\` and configure:

| Variable | Default | Description |
|---|---|---|
| \`PORT\` | \`3000\` | Server port |
| \`NODE_ENV\` | \`development\` | Environment |

## Learn More

- [KickJS Documentation](https://kickjs.app/)
- [CLI Reference](https://kickjs.app/api/cli.html)
`
}

/**
 * Generate CLAUDE.md.
 *
 * v4 update: this file is intentionally thin. AGENTS.md is the
 * canonical, multi-agent project reference (Claude / Copilot /
 * Codex / Gemini / etc.) — duplicating it here meant two files
 * drifting out of sync after every framework change. The generated
 * CLAUDE.md now redirects there + adds Claude-specific affordances
 * only.
 */
export function generateClaude(name: string, _template: ProjectTemplate, pm: string): string {
  return `# CLAUDE.md — ${name}

**Read \`./.agents/AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project (Claude, Copilot, Codex, Gemini, etc.) —
project conventions, structure, decorator patterns, env wiring, CLI
generators, every gotcha.

**Then browse \`./.agents/skills/\`.** Each subdirectory is a single
task-oriented skill (\`add-module/\`, \`write-controller-test/\`,
\`bootstrap-export/\`, \`deny-list/\`, …) containing a \`SKILL.md\`
with YAML frontmatter (\`name\`, \`description\`) and the recipe body.
The structure follows the Claude Code skills convention — agents that
auto-load skills from \`.agents/skills/\` will pick each up by its
frontmatter. Use this directory as the playbook when executing common
KickJS workflows.

This file is a thin Claude-specific layer on top of those two; when
they disagree on anything substantive, treat \`.agents/AGENTS.md\` as
authoritative and flag the discrepancy.

## Why \`.agents/\` + this thin pointer

\`.agents/AGENTS.md\` is what every agent reads (Codex, Cursor, Gemini,
Copilot, Aider, …) — one canonical source so the prose doesn't drift
across copies. \`CLAUDE.md\` is what Claude Code automatically loads as
project context on each conversation, so it stays at the project root.
Keeping CLAUDE.md slim and pointing at \`.agents/\` avoids two
out-of-sync copies of the same content. Per-agent files
(\`.agents/GEMINI.md\`, \`.agents/COPILOT.md\`) live alongside
\`AGENTS.md\` for tool-specific notes that don't belong in the shared
prose.

## Claude-specific notes

- **Slash commands** — \`/help\` for Claude Code commands; \`/init\`
  to refresh project memory if AGENTS.md changes substantially.
- **Feedback** — file issues at <https://github.com/anthropics/claude-code/issues>.
- **Persistent memory** — Claude maintains user/feedback/project/
  reference memories under \`.claude/memory/\`. If you ask for
  something that contradicts a remembered preference, Claude flags
  it before acting; corrections update memory automatically.
- **Long-running tasks** — \`/loop\` and \`/schedule\` for recurring
  or background work. Useful for "wait for the deploy then open a
  cleanup PR" or "every Monday triage the issue board" patterns.

## Quick reference (full version in .agents/AGENTS.md)

\`\`\`bash
${pm} install            # Install dependencies
kick dev                 # Dev server with HMR + typegen
kick build && kick start # Production
${pm} run test           # Vitest
kick typecheck           # tsc/tsgo, whichever the project has
kick format              # oxfmt
\`\`\`

## v4 framework reminders

When generating or modifying code in this project, stay aligned with the v4 conventions documented in \`.agents/AGENTS.md\`:

- **Adapters**: \`defineAdapter()\` factory — never \`class implements AppAdapter\`.
- **Plugins**: \`definePlugin()\` factory — never plain function returning \`KickPlugin\`.
- **DI tokens**: \`<scope>/<PascalKey>[/<suffix>]\` — scope is lowercase, the key segment is **PascalCase** (e.g. \`'app/Users/repository'\`, \`'mycorp/Cache/redis'\`). First-party uses the reserved \`'kick/'\` prefix; this project owns its own scope.
- **Decorators**: \`@Controller()\` (no path arg — mount prefix comes from \`routes().path\`).
- **HTTP runtime**: this app may run on Express, Fastify, or h3 — check \`kick.config.ts\` \`runtime\` (or \`bootstrap({ runtime })\`) before writing engine-specific code. Prefer engine-neutral \`ctx\` APIs (\`ctx.json\`/\`ctx.body\`/\`ctx.params\`/\`ctx.sse\`); don't assume \`ctx.req\` is an Express request. Uploads (\`@FileUpload\` → \`ctx.file\`/\`ctx.files\`) work on all three (\`kick add upload\` installs the driver). Full rules in \`.agents/AGENTS.md\` → "HTTP runtime".
- **Module entry file** MUST be named \`<name>.module.ts\` and live under \`src/modules/<name>/\`. The Vite plugin auto-discovers \`*.module.[tj]sx?\` for graceful HMR — a misnamed \`projects.ts\` silently degrades every save into a full restart.
- **Env**: schema lives in \`src/config/index.ts\`; \`import './config'\` MUST be the first import in \`src/index.ts\` (side-effect registers the schema before any \`@Value\` resolves).
- **Assets**: drop new template files into \`src/templates/<namespace>/\`; the dev watcher auto-rebuilds the \`KickAssets\` augmentation + \`assets.x.y()\` re-walks on next call. No restart, no manual build.
- **Context Contributors** (\`defineContextDecorator\`) over \`@Middleware()\` for ctx-population work.
- **Repos under tests**: \`Container.create()\` for isolation — never \`new Container()\` or \`getInstance().reset()\`.
- **Bootstrap export**: \`src/index.ts\` must end with \`export const app = await bootstrap({ ... })\`. The Vite plugin and \`createTestApp\` import the named \`app\`; without the export, HMR silently degrades to full restarts.
- **Thin entry file**: aggregate \`modules\`, \`middleware\`, \`plugins\`, \`adapters\` in their own folders (\`src/modules/index.ts\`, \`src/middleware/index.ts\`, …) and pass them by name to \`bootstrap()\` — never inline the lists in \`src/index.ts\`.
- **Refresh these files**: \`kick g agents -f\` regenerates \`CLAUDE.md\` at the project root and \`.agents/AGENTS.md\` + \`.agents/GEMINI.md\` + \`.agents/COPILOT.md\` + every \`.agents/skills/<name>/SKILL.md\` from the latest CLI templates. Hand-edited content is overwritten — keep customisation in \`.agents/AGENTS.local.md\` or per-skill \`SKILL.local.md\` files alongside.

For everything else (controllers, services, modules, RequestContext API, generators, CLI commands, package additions, env wiring, troubleshooting) → \`.agents/AGENTS.md\`.
`
}

/** Generate AGENTS.md with AI agent guide */
export function generateAgents(name: string, template: ProjectTemplate, pm: string): string {
  return `# AGENTS.md — AI Agent Guide for ${name}

This guide is the **canonical, multi-agent reference** for this KickJS
application — Claude, Copilot, Codex, Gemini, etc. all read it first.
Per-agent files (\`CLAUDE.md\`, \`GEMINI.md\`, etc.) are thin layers that
add tool-specific affordances on top.

## Before You Start

1. Run \`${pm} install\` to install dependencies
2. Run \`kick dev\` to verify the app starts${
    template === 'fullstack'
      ? `

## Fullstack workspace layout

This is a WORKSPACE root — the KickJS API lives in \`server/\`, the typed web
app in \`web/\`. Run both with \`${pm === 'pnpm' ? 'pnpm dev' : `${pm} run dev:server + ${pm} run dev:web`}\`.

The type loop (do not break it):
1. \`server/\` handlers RETURN their payloads → \`kick typegen\` (auto under
   \`kick dev\`) emits \`server/.kickjs/types/kick__routes.ts\` incl. the flat
   \`KickRoutes.Api\` map with inferred response types.
2. \`web/src/types/kick-routes.d.ts\` imports that file TYPE-ONLY.
3. \`web/src/api.ts\` = \`createClient<KickApi>({ baseUrl: '/api/v1' })\`
   — every call site is typed from the server's handlers.

Rules: kick commands (\`kick g\`, \`kick typegen\`, \`kick dev\`) run in
\`server/\`; never import server runtime code into \`web/\` (the d.ts bridge is
type-only); prefer return-value handlers so responses stay inferable.`
      : ''
  }
3. Read the [KickJS documentation](https://kickjs.app/) for framework details

## HTTP runtime — DON'T assume Express-only

KickJS is **engine-pluggable**. It runs on **Express (default), Fastify, or h3** —
chosen with one line: \`bootstrap({ runtime: fastifyRuntime() })\`. Before writing
any engine-specific code, **check which engine this project uses**:

- \`kick.config.ts\` → the \`runtime\` field (\`'express'\` | \`'fastify'\` | \`'h3'\`), and/or
- \`src/index.ts\` → the \`runtime:\` passed to \`bootstrap()\`, and/or
- \`package.json\` → \`fastify\` / \`h3\` in deps.

Rules that keep generated code correct on **every** engine:

- **Prefer return-value handlers.** \`return payload\` sends 200 json on every
  engine and lets \`kick typegen\` infer the response type into
  \`KickRoutes.Api\` (consumed by the \`@forinda/kickjs-client\` typed client);
  \`reply(status, body)\` for non-200, \`reply.noContent()\` for 204. A declared
  \`{ response: schema }\` on the route feeds BOTH the OpenAPI success response
  and the typegen response type. \`ctx.json(...)\` stays fully supported but
  infers \`unknown\`.
- **Lifecycle hooks:** \`@PostConstruct()\` after instantiation; \`@PreDestroy()\`
  when a REQUEST-scoped service's request closes (release transactions/handles).
- **Write to \`ctx\`, not the raw request/response.** \`ctx.json()\`, \`ctx.body\`,
  \`ctx.params\`, \`ctx.query\`, \`ctx.set/get\`, \`ctx.sse()\` are engine-neutral and
  work identically everywhere. \`ctx.req\` / \`ctx.res\` are the engine-native
  objects — their **type follows the active runtime** (Express by default; the
  \`kick/runtime\` typegen retypes them to Fastify / h3 when \`runtime\` is set).
  Don't assume \`ctx.req\` is an \`express.Request\` in portable code.
- **Global middleware** in \`bootstrap({ middleware })\` is connect-style
  \`(req, res, next)\` — it runs on all engines (Fastify via \`@fastify/middie\`,
  h3 via \`fromNodeMiddleware\`). But on Fastify / h3 the engine parses the body
  natively, so the default \`express.json()\` is **auto-skipped** (\`nativeBodyParsing\`).
  Don't add \`express.json()\` manually on those engines.
- **File uploads** work on all three: \`@FileUpload({ mode, fieldName, ... })\` →
  \`ctx.file\` / \`ctx.files\` (same Multer-shaped object everywhere). Backends:
  Express \`multer\`, Fastify \`@fastify/multipart\`, h3 native. Run
  \`kick add upload\` to install the runtime-correct driver. The \`@FileUpload\`
  decorator is **memory-only** (portable); disk / custom-storage (\`storage\` /
  \`dest\`) is Express-only via the \`upload.single/array()\` middleware.
- **Engine subpaths**: \`import { fastifyRuntime } from '@forinda/kickjs/fastify'\`
  or \`h3Runtime\` from \`'@forinda/kickjs/h3'\`. Express is the zero-config default
  (no import, nothing to install).
- **Not supported on Fastify / h3**: \`ctx.render()\` (no view engine). Calling it
  throws a clear error rather than failing silently.
- Run \`kick doctor\` to verify the runtime's engine peers + upload driver are installed.

## v4 Conventions (don't skip)

KickJS v4 made a handful of structural changes from v3. Internalise these
before generating or modifying code — they are the source of most agent
mistakes:

- **Adapters** — \`defineAdapter()\` factory. Never write \`class Foo implements AppAdapter\`.

  \`\`\`ts
  export const MyAdapter = defineAdapter<MyOptions>({
    name: 'MyAdapter',
    defaults: { ... },
    build: (config) => ({
      beforeMount({ app }) { /* ... */ },
      afterStart({ server }) { /* ... */ },
    }),
  })
  \`\`\`

- **Plugins** — \`definePlugin()\` factory. Same shape, never plain function returning \`KickPlugin\`.

- **DI tokens** — \`<scope>/<PascalKey>[/<suffix>]\`. Scope is lowercase,
  the key segment is **PascalCase** (the regex enforces both):

  \`\`\`ts
  const USERS_REPO = createToken<UsersRepo>('app/Users/repository')
  const DB         = createToken<Database>('app/Db/connection')
  \`\`\`

  The \`kick/\` prefix is reserved for first-party packages; this project
  owns its own scope (\`app/\`, your domain name, etc.).

- **\`@Controller()\`** takes **no path argument**. Mount prefix comes from
  the module's \`routes()\` return value, not the decorator. \`@Controller('/users')\`
  is a v3 leftover; the linter and codegen reject it.

- **Env wiring** — \`src/config/index.ts\` calls \`loadEnv(envSchema)\` as a
  side effect. \`src/index.ts\` MUST have \`import './config'\` as its **first**
  import (before \`bootstrap()\`). Without it, \`ConfigService.get('YOUR_KEY')\`
  returns \`undefined\` and \`@Value()\` only works via raw \`process.env\` fallback
  (Zod coercion + defaults silently skipped).

- **Module entry files MUST be named \`<name>.module.ts\`** — see the Vite
  HMR contract at the top of "Module Pattern" below. The CLI enforces this;
  hand-rolled files must too.

- **Assets** — drop new template files into \`src/templates/<namespace>/\`
  (or wherever \`kick.config.ts\` points). The dev watcher auto-rebuilds the
  \`KickAssets\` augmentation; \`assets.x.y()\` re-walks on next call. No restart,
  no manual build step.

- **Context over \`@Middleware()\`** — when a middleware's only job is to
  populate \`ctx.set('key', value)\`, use \`defineHttpContextDecorator()\`
  (HTTP) or \`defineContextDecorator()\` (transport-agnostic) instead.
  Typed via \`ContextMeta\`, ordered via \`dependsOn\`, validated at boot.
  Reserve \`@Middleware()\` for response short-circuit / stream mutation /
  pre-route-matching work.

  Two ground rules around the data flow — both stem from the fact that
  every per-request stage gets its OWN \`RequestContext\` instance, all
  reading/writing the SAME \`AsyncLocalStorage\`-backed Map:
  - **\`resolve\` and \`onError\` must RETURN the value.** The runner
    writes it via \`ctx.set(reg.key, value)\` on your behalf. Direct
    property assignment (\`ctx.tenant = …\`) sticks to the contributor
    instance only — the handler instance never sees it.
  - **Read across instances via \`ctx.set\` / \`ctx.get\`** (or
    \`getRequestValue(key)\` from a service that has no \`ctx\` reference
    — typed via \`MetaValue<K>\`). \`ctx.req\` works because the underlying
    Express request is shared; bespoke property assignments don't.

- **Test isolation** — default to \`Container.create()\` for fresh DI state.
  Never \`new Container()\` and never \`getInstance().reset()\` — both leak
  registrations between tests.

  \`\`\`ts
  const container = Container.create()
  // ... register test-scoped providers, run, discard
  \`\`\`

- **Bootstrap export** — \`src/index.ts\` MUST end with
  \`export const app = await bootstrap({ ... })\`. The Vite plugin imports
  the named \`app\` symbol to drive HMR module swaps; testing helpers
  (\`createTestApp\`) and the OpenAPI introspector also rely on it. Drop
  the \`export\` and \`kick dev\` will silently fall back to a full restart
  on every save while \`createTestApp\` complains about a missing handle.

- **Keep \`src/index.ts\` thin** — collect plugins, modules, middleware, and
  adapters in dedicated folders and re-export aggregated arrays. Do **not**
  inline registration in the entry file:

  \`\`\`ts
  // src/modules/index.ts — fluent chain (default for \`modules.style: 'define'\`)
  export const modules = defineModules().mount(HelloModule()).mount(UsersModule())
  // OR with \`modules.style: 'class'\`:
  //   export const modules: AppModuleEntry[] = [HelloModule, UsersModule]

  // src/middleware/index.ts
  export const middleware = [helmet(), cors(), requestId(), ...]

  // src/plugins/index.ts
  export const plugins = [MetricsPlugin(), AuditPlugin()]

  // src/adapters/index.ts
  export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]
  \`\`\`

  \`\`\`ts
  // src/index.ts — stays small; one import per category
  import 'reflect-metadata'
  import './config'
  import { bootstrap } from '@forinda/kickjs'
  import { modules } from './modules'
  import { middleware } from './middleware'
  import { plugins } from './plugins'
  import { adapters } from './adapters'

  export const app = await bootstrap({ modules, middleware, plugins, adapters })
  \`\`\`

  This keeps the entry file diff-friendly, scales to dozens of modules
  without git churn, and lets each domain own its own registration list.
  The generators (\`kick g module\`, \`kick g middleware\`, \`kick g plugin\`,
  \`kick g adapter\`) follow this layout — manual additions should too.

Everything else (controllers, services, modules, RequestContext API, generators,
package additions, env access patterns, troubleshooting) is detailed below.

## Where to Find Things

### Application Structure

| What | Where |
|------|-------|
| Entry point | \`src/index.ts\` |
| Module registry | \`src/modules/index.ts\` |
| Feature modules | \`src/modules/<module-name>/\` |
| **Module entry file** | \`src/modules/<name>/<name>.module.ts\` (filename suffix is required — see Vite HMR contract below) |
| Env values | \`.env\` |
| Env schema (Zod) | \`src/config/index.ts\` |
| TypeScript config | \`tsconfig.json\` |
| Vite config (HMR) | \`vite.config.ts\` |
| Vitest config | \`vitest.config.ts\` |
| Formatter config | \`.oxfmtrc.json\` (oxfmt) |
| CLI config | \`kick.config.ts\` |

### Module Pattern (${template.toUpperCase()})

> **Vite HMR auto-discovery contract:** module files **must** be named \`<name>.module.ts\` (or \`.tsx\`/\`.js\`/\`.jsx\`) and live under \`src/modules/\`. The Vite plugin scans for \`*.module.[tj]sx?\` to drive graceful HMR rebuilds; renaming a file to \`projects.ts\` (no \`.module\`) silently breaks HMR — saves trigger a full restart instead of a swap. The CLI generator (\`kick g module <name>\`) follows the convention; manual files must too.

Each module in \`src/modules/<name>/\` typically contains:

${
  template === 'rest'
    ? `\`\`\`
<name>/
├── <name>.controller.ts     # HTTP routes (@Controller)
├── <name>.service.ts        # Business logic (@Service)
├── <name>.repository.ts     # Data access (@Repository)
├── dtos/                    # Request/response schemas (Zod)
└── <name>.module.ts         # Module definition (defineModule factory)
\`\`\`
`
    : `\`\`\`
src/
├── index.ts                 # Add routes here
└── ...                      # Custom structure
\`\`\`
`
}

## Checklist: Adding a Feature

Follow the **\`kickjs-add-module\`** skill — it has the ordered steps, the
canonical \`defineModule\` shape, and the \`import.meta.glob\` requirement that
silently breaks DI when omitted.

## Common Tasks

Each of these has a skill with the steps and the traps:

| Task | Skill |
| --- | --- |
| Add a feature module | \`kickjs-add-module\` |
| Add an adapter | \`kickjs-add-adapter\` |
| Add a plugin | \`kickjs-add-plugin\` |
| Add a context contributor | \`kickjs-context-contributor\` |
| Write a controller test | \`kickjs-write-controller-test\` |
| List endpoint with filters / pagination | \`kickjs-query-parsing-list-endpoint\` |
| Serve bundled assets | \`kickjs-use-asset-manager\` |
| Anything else | \`kickjs-docs-lookup\` |

## Testing Guidelines

See the **\`kickjs-write-controller-test\`** skill for the canonical test — it
carries the call shape, the DI reset, and the env side-effect import, each of
which has its own failure mode.

Run with \`${pm} run test\` (\`test:watch\` for watch mode).

## Environment Variables

The schema lives in \`src/config/index.ts\` and registers itself with kickjs **at
module load**; \`src/index.ts\` imports it (\`import './config'\`) before
\`bootstrap()\` so the cache is populated before DI resolves anything. Add a key
to the schema, put its value in \`.env\`, and it is typed everywhere.

Read it with \`@Value('KEY')\` for construction-time values, or inject
\`ConfigService\` for dynamic access.

When a key reads as \`undefined\`, use the **\`kickjs-env-wiring-check\`** skill or
run \`kick explain "ConfigService.get('KEY') returned undefined"\`. The cause
differs between app code and tests and the two look identical, which is what
makes it slow to spot.

## Standalone Utilities (No DI Required)

These work anywhere — scripts, plain files, outside \`@Service\`/\`@Controller\`:

| Utility | Import | Example |
|---------|--------|---------|
| \`Logger.for(name)\` | \`@forinda/kickjs\` | \`const log = Logger.for('MyScript')\` |
| \`createLogger(name)\` | \`@forinda/kickjs\` | \`const log = createLogger('Worker')\` |
| \`createToken<T>(name)\` | \`@forinda/kickjs\` | \`const TOKEN = createToken<string>('app/Db/url')\` |
| \`ref(value)\` | \`@forinda/kickjs\` | \`const count = ref(0)\` |
| \`computed(fn)\` | \`@forinda/kickjs\` | \`const doubled = computed(() => count.value * 2)\` |
| \`watch(source, cb)\` | \`@forinda/kickjs\` | \`watch(() => count.value, (v) => log(v))\` |
| \`reactive(obj)\` | \`@forinda/kickjs\` | \`const state = reactive({ count: 0 })\` |
| \`HttpException\` | \`@forinda/kickjs\` | \`throw new HttpException(404, 'Not found')\` |
| \`HttpStatus\` | \`@forinda/kickjs\` | \`HttpStatus.NOT_FOUND // 404\` |

## Key Decorators

### HTTP Routes
| Decorator | Purpose |
|-----------|---------|
| \`@Controller()\` | Define route prefix |
| \`@Get('/'), @Post('/')\` | HTTP method handlers |
| \`@Middleware(fn)\` | Attach middleware |
| \`@Public()\` | Skip auth (requires auth adapter) |
| \`@Roles('admin')\` | Role-based access |

### Dependency Injection
| Decorator | Purpose |
|-----------|---------|
| \`defineModule({...})\` | Define feature module (factory; preferred — paired with \`defineModules()\` registry) |
| \`defineModules()\` | Build the modules registry as a chainable list (\`.mount(X())\`) |
| \`AppModule\` interface | Legacy module shape — \`class X implements AppModule\` (toggle via \`modules.style: 'class'\`) |
| \`@Service()\` | Register singleton service |
| \`@Repository()\` | Register repository |
| \`@Autowired()\` | Property injection |
| \`@Inject('token')\` | Token-based injection |
| \`@Value('VAR')\` | Inject env variable |

### Context Decorators

Typed, ordered way to populate \`ctx.set/get\` keys before the handler runs.
Use this **instead of \`@Middleware()\`** when the middleware's only output
is a value other code reads off \`ctx\`.

**Authoring** — pick the right factory:

| Factory | When |
|---------|------|
| \`defineHttpContextDecorator(spec)\` | HTTP only (the common case). \`Ctx\` is \`RequestContext\`, so \`ctx.req\` / \`ctx.params\` / \`ctx.query\` are typed. |
| \`defineContextDecorator(spec)\` | Transport-agnostic (HTTP + WS + queue + cron). \`Ctx\` is \`ExecutionContext\` — only \`get\` / \`require\` / \`set\` / \`requestId\`. |
| \`<either>.withParams<P>()(spec)\` | The contributor takes per-call params. **Always use the curried form for params** — the positional form forces you to spell \`K\` and \`D\` and loses \`deps\` inference. |

Spec fields: \`{ key, deps, dependsOn, optional, paramDefaults, requiredParams, onError, resolve }\`.

**Call sites — all five, precedence high → low:**

| # | Site | Form |
|---|------|------|
| 1 | Method | \`@LoadX\` / \`@LoadX({ ... })\` above a controller method |
| 2 | Class | \`@LoadX\` / \`@LoadX({ ... })\` above the controller class |
| 3 | Module | \`defineModule({ build: () => ({ contributors: () => [LoadX.registration] }) })\` — or \`AppModule.contributors?()\` in class form |
| 4 | Adapter | \`AppAdapter.contributors?(): ContributorRegistration[]\` |
| 5 | Global | \`bootstrap({ contributors: [LoadX.registration] })\` |

Sites 3–5 take **registrations**, not decorators:

- \`LoadX.registration\` — uses \`paramDefaults\` as-is.
- \`LoadX.with({ ...params }).registration\` — call-site params merged over \`paramDefaults\`.

Duplicate keys are resolved by precedence; the lower-precedence one is
dropped silently, which is how a method-level decorator overrides an
adapter-shipped default.

**Params:** a **required** field of \`P\` with no \`paramDefaults\` entry must be
supplied at every call site — \`@LoadX\` bare, \`@LoadX()\`, and \`.registration\`
are compile errors for such a decorator. Never invent a placeholder default
just to make the type check; add \`requiredParams: ['field']\` for runtime
enforcement at JS call sites.

**Reading values:** \`ctx.require('key')\` for values a contributor guarantees
(throws \`MissingContextValueError\`, returns a non-optional type);
\`ctx.get('key')\` for \`optional: true\` contributors and ad-hoc keys (returns
\`| undefined\`). Never \`ctx.get('key')!\` — it compiles even when the producing
decorator isn't applied to the route.

| Concept | Where it lives |
|---------|----------------|
| Type augmentation (value types) | \`declare module '@forinda/kickjs' { interface ContextMeta { ... } }\` |
| Type augmentation (key-only) | \`declare module '@forinda/kickjs' { interface ContextKeys { ... } }\` — valid in \`dependsOn\`, value stays \`unknown\` |

Cycles and missing \`dependsOn\` keys throw at \`app.setup()\` (boot fails
fast). The \`onError\` hook is async-permitted.

Full guide: <https://kickjs.app/guide/context-decorators>.

## Common Pitfalls

See the **\`kickjs-deny-list\`** skill — the maintained list of things that
compile, run, and are still wrong.

For a specific failure, \`kick explain "<error message>"\` beats reading either:
it matches the message against known causes and prints the fix.

## CLI Commands Reference

See the **\`kickjs-cli-commands-cheatsheet\`** skill for the full table, the
shell-safe field syntax, and the non-obvious flags. \`kick --help\` and
\`kick <cmd> --help\` are authoritative for the installed version.

## Learn More

Use the **\`kickjs-docs-lookup\`** skill — it maps questions to the right guide
page and lists the local tools (\`kick explain\`, \`kick doctor\`, \`kick inspect\`,
\`.kickjs/types/\`) that usually answer faster than a search.

Start at <https://kickjs.app/>.

`
}

/**
 * One emitted skill — slug becomes the directory name under
 * `.agents/skills/<slug>/SKILL.md`. `frontmatterName` is the value
 * agents use to look the skill up at activation time and follows the
 * `kickjs-<slug>` convention to keep the skill registry namespaced.
 */
export interface KickJsSkillFile {
  /** kebab-case directory name (`add-module`, `write-controller-test`). */
  slug: string
  /** Full SKILL.md content with YAML frontmatter + body. */
  content: string
}

/**
 * Render every KickJS task-skill as its own `SKILL.md` file, ready to
 * write under `.agents/skills/<slug>/SKILL.md`. Each file follows the
 * standard Claude Code skill format:
 *
 * ```
 * ---
 * name: kickjs-<slug>
 * description: <when to use this skill>
 * ---
 *
 * <body>
 * ```
 *
 * Agents that auto-discover skills from `.agents/skills/` (Claude
 * Code, Copilot CLI plugins, Gemini's activate_skill) pick each up by
 * its frontmatter without us shipping an index file. The legacy
 * single-file format (`kickjs-skills.md`) is gone — adopters with
 * existing root-level copies keep them untouched until they run
 * `kick g agents -f --only skills`, which emits the new layout
 * alongside without deleting the old file.
 */
interface KickJsSkill {
  slug: string
  frontmatterName: string
  description: string
  body: string
}

/**
 * Single source of truth for the agent skills.
 *
 * Rendered twice — one `SKILL.md` per entry, and the aggregate
 * `kickjs-skills.md`. The aggregate used to restate all of this by hand and had
 * drifted badly: 9 skills against 13, with an env recipe still naming a
 * superseded API. Add a skill here and both outputs pick it up.
 */
function buildSkills(pm: string): KickJsSkill[] {
  const skills: Array<{
    slug: string
    frontmatterName: string
    description: string
    body: string
  }> = [
    {
      slug: 'add-module',
      frontmatterName: 'kickjs-add-module',
      description:
        'Use when the user asks to add a new feature module (controller + service + repo + DTOs).',
      body: `**Trigger phrases**: "add a users module", "scaffold tasks", "new feature for X".

**Steps**:
1. Run \`kick g module <name>\` (use plural form if the project pluralizes — check \`kick.config.ts\`).
2. Verify the new folder under \`src/modules/<name>/\` contains \`<name>.module.ts\` (filename suffix is mandatory for Vite HMR).
3. Confirm the module appears in \`src/modules/index.ts\` exports — generator does this automatically; verify if you bypassed it.
4. Open \`<name>.dto.ts\` and tighten the Zod schemas to real fields (the generator emits placeholders).
5. Run \`kick typecheck\` and \`${pm} run test\` before claiming done.

**Canonical module shape** — \`defineModule\` factory, never \`class implements AppModule\`:

\`\`\`ts
export const TodosModule = defineModule({
  name: 'TodosModule',
  build: () => ({
    register(container) {
      container.registerFactory(TODO_REPO, () => container.resolve(InMemoryTodoRepository))
    },
    routes() {
      return { path: '/todos', controller: TodosController }
    },
  }),
})
\`\`\`

The module file MUST include \`import.meta.glob([...], { eager: true })\` for every \`@Controller\` / \`@Service\` / \`@Repository\` / \`@Component\` class — without it, decorators never fire and DI silently resolves to \`undefined\` (or routes vanish). Use **recursive** patterns (\`./**/*.controller.ts\`) so the glob keeps working when you nest files into sub-folders (\`controllers/\`, \`presentation/\`, …). If you reorganise and a class stops loading, \`kick typegen\` flags it as orphaned and \`kick typegen --fix\` patches the glob for you.

**Multiple route sets / versioning** — \`routes()\` may return an array with per-entry \`version\` override:

\`\`\`ts
routes() {
  return [
    { path: '/todos', controller: TodosController },               // /api/v1/todos
    { path: '/todos', version: 2, controller: TodosV2Controller }, // /api/v2/todos
  ]
}
\`\`\`

**Conditional / per-tenant mounting** — use \`bootstrap({ setup(registry) { registry.mount(...) } })\`, not the static \`modules\` array.

**Composition** — \`defineModules().mount(TodosModule()).mount(UsersModule())\` (fluent) or \`AppModuleEntry[]\` (array form).

**Red flags** (stop and ask):
- File created as \`<name>.ts\` instead of \`<name>.module.ts\` — Vite plugin's \`*.module.[tj]sx?\` glob doesn't pick it up; every save becomes a full restart.
- \`@Controller('/path')\` with a path argument combined with module \`routes().path\` — duplicates the prefix. The decorator path is OpenAPI metadata only.
- \`TodosModule\` in \`bootstrap({ modules: [TodosModule] })\` instead of \`TodosModule()\` — passing the factory instead of the invoked instance.
- \`routes()\` returning \`router: …\` when a \`controller:\` would do — controller form is required for OpenAPI/Swagger introspection.
- Module not registered in \`src/modules/index.ts\`.`,
    },
    {
      slug: 'add-adapter',
      frontmatterName: 'kickjs-add-adapter',
      description:
        'Use when wiring a single-concern lifecycle integration (Swagger, DevTools, Sentry, Redis client).',
      body: `**Steps**:
1. \`kick g adapter <name>\` to scaffold the boilerplate, OR install via \`kick add <package>\` for first-party adapters.
2. The generated file uses \`defineAdapter()\` — never \`class implements AppAdapter\`.
3. Add the adapter instance (note the parens) to \`src/adapters/index.ts\` — don't inline in \`src/index.ts\`.
4. Pick the right hook and middleware phase deliberately.
5. Verify with \`kick dev\` that the adapter's lifecycle logs fire.

**Canonical shape** — factory closure owns instance state:

\`\`\`ts
export const RedisAdapter = defineAdapter<RedisConfig>({
  name: 'RedisAdapter',
  defaults: { url: 'redis://localhost' },
  build: (config) => {
    const client = createClient(config.url)
    return {
      beforeStart: ({ container }) => {
        container.registerInstance(REDIS_CLIENT, client)
      },
      afterStart: () => client.connect(),
      shutdown: () => client.quit(),
    }
  },
})

// In src/adapters/index.ts:
export const adapters = [RedisAdapter({ url: env.REDIS_URL })] // <-- note parens
\`\`\`

**Lifecycle hook decision tree**:
- \`beforeMount\` — register early routes that should bypass middleware (health, docs UI).
- \`beforeStart\` — DI ready, server not listening yet. **Use this for \`container.registerInstance(...)\` calls** so they work under \`createTestApp\` too.
- \`afterStart\` — server has \`ctx.server\` available. Only use for things that need a listening server (Socket.IO upgrades, port logging). **Doesn't fire under \`createTestApp\`.**
- \`shutdown\` — runs concurrently via \`Promise.allSettled\`, so one failure doesn't block siblings (but errors are swallowed — log inside).

**Middleware phases** (see \`MiddlewarePhase\` JSDoc):
\`beforeGlobal\` | \`afterGlobal\` (default) | \`beforeRoutes\` | \`afterRoutes\` (fires only on fall-through — matched routes that respond skip it).

**Multi-instance** — \`.scoped('cache', { url: ... })\` makes \`name\` become \`RedisAdapter:cache\`. **Deferred config** — \`.async({ inject, useFactory })\` for config that depends on DI-resolved services.

**Red flags**:
- \`bootstrap({ adapters: [MyAdapter] })\` — passed the factory, not the instance. Call it: \`MyAdapter()\`.
- Inlining the adapter list directly in \`src/index.ts\` — entry file should stay thin.
- Returning a plain object instead of going through \`defineAdapter()\` — type inference for \`config\` will be wrong.
- Using \`.async()\` for an adapter that returns \`middleware()\` / \`contributors()\` / \`beforeMount()\` / \`onRouteMount()\` — those hooks have already run by the time \`.async()\` resolves and are silently skipped.
- Cross-adapter ordering via array position when it's load-bearing — use \`dependsOn: ['OtelAdapter']\`; cycles throw \`MountCycleError\` at boot.
- Using an adapter when the integration ships **modules + DI bindings + middleware** together → that's a plugin. Promote to \`definePlugin()\` (see \`add-plugin\` skill).

**Nuances**:
- \`AdapterContext.server\` is \`undefined\` outside \`afterStart\`.
- \`shutdown\` errors are swallowed by \`Promise.allSettled\` — wrap in try/catch and log if you care.`,
    },
    {
      slug: 'add-plugin',
      frontmatterName: 'kickjs-add-plugin',
      description:
        'Use when scaffolding a feature that bundles modules + DI + middleware + adapters together (auth, monitoring suite, multi-tenant scaffolding).',
      body: `**When plugin > adapter**: a plugin is the right answer when the integration ships **more than one** of: a module, a DI binding, middleware, or another adapter. If you have a single hook (\`beforeStart\`) and no other contributions, use \`defineAdapter\` instead.

**Canonical shape**:

\`\`\`ts
import { definePlugin } from '@forinda/kickjs'

export const AuthPlugin = definePlugin({
  name: 'AuthPlugin',
  defaults: { tokenTtl: '1h' },
  build: (config, { name }) => ({
    modules: () => [AuthModule()],
    adapters: () => [JwtAdapter({ ttl: config.tokenTtl })],
    middleware: () => [requestIdMiddleware()],
    register(container) {
      container.registerFactory(TOKEN_SIGNER, () => createSigner(config))
    },
    contributors() {
      return [LoadCurrentUser.registration]
    },
    onReady({ server }) {
      log.info(\`AuthPlugin listening on port \${server.address().port}\`)
    },
  }),
})

// In bootstrap:
bootstrap({ plugins: [AuthPlugin({ tokenTtl: env.TOKEN_TTL })] }) // <-- parens
\`\`\`

**Inline plugin literal** — the canonical answer for one-off DI bindings. There's no top-level \`register:\` on \`bootstrap\` itself:

\`\`\`ts
bootstrap({
  plugins: [{ name: 'vector-store', register(c) { c.registerInstance(VECTOR_STORE, store) } }],
})
\`\`\`

**Execution order** (memorize):
plugin \`register()\` → plugin \`middleware()\` → plugin \`modules()\` + user modules → plugin \`adapters()\` + user adapters → server listens → plugin \`onReady()\`.

**Static vs dynamic modules**: \`modules()\` returning an array is introspectable (Swagger, DevTools see it). \`setup(registry)\` is imperative — pick the latter when the module set depends on resolved config.

**Multi-instance** — \`.scoped('users', { url })\`; derive unique DI tokens from \`ctx.name\` inside \`build\`:

\`\`\`ts
build: (config, { name }) => ({
  register(c) {
    c.registerInstance(createToken(\`cache/\${name}\`), client)
  },
})
\`\`\`

**Precedence**: plugin contributors land at \`'adapter'\` precedence — beat global, lose to module/class/method same-key.

**Red flags**:
- \`bootstrap({ plugins: [AuthPlugin] })\` — passed factory. Call it: \`AuthPlugin()\`.
- Reaching for a plugin when an adapter would do (no modules, no DI bindings, no contributors) — overkill; use \`defineAdapter()\`.
- \`.async()\` plugin that depends on \`modules()\` / \`middleware()\` / \`adapters()\` / \`contributors()\` — those are dropped. \`.async()\` only resolves \`register()\` + \`onReady()\`.
- Confusing CLI plugins (\`defineCliPlugin\` from \`@forinda/kickjs-cli\`) with runtime plugins (\`definePlugin\` from \`@forinda/kickjs\`) — different surfaces, different registration sites.
- \`dependsOn: ['SomePlugin']\` referring to a plugin not in the boot list — throws \`MissingMountDepError\` at boot.

**Nuances**:
- \`definition\` is \`Object.freeze\`'d metadata; useful for version checks (\`compare(AuthPlugin.definition.version, '1.2.0')\`) — not mountable.`,
    },
    {
      slug: 'write-controller-test',
      frontmatterName: 'kickjs-write-controller-test',
      description: 'Use when adding a Vitest test that exercises an HTTP route or DI graph.',
      body: `**Template** (copy/paste, adjust):

\`\`\`ts
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'
// Side-effect import — registers the env schema, exactly as src/index.ts does.
// \`createTestApp\` never loads the entry file, so without this
// \`ConfigService.get('YOUR_KEY')\` is undefined under test while \`@Value()\`
// still appears to work via its process.env fallback — the two disagree only
// in tests.
import '@/config'

describe('UserController', () => {
  beforeEach(() => Container.reset()) // isolate DI between tests

  it('returns users', async () => {
    // \`createTestApp\` takes an OPTIONS OBJECT and returns
    // \`{ app, expressApp, container }\`. Passing a bare array throws
    // "this.options.modules is not iterable"; the result has no \`.get()\`.
    const { expressApp } = await createTestApp({
      modules: [UserModule],
    })
    const res = await request(expressApp).get('/api/v1/users')
    expect(res.status).toBe(200)
  })
})
\`\`\`

**Typed handler signature** — pair with \`kick typegen\` so \`ctx.body\` / \`params\` / \`query\` are typed by the route's Zod schema:

\`\`\`ts
@Post('/', { body: createTodoSchema })
async create(ctx: Ctx<KickRoutes.TodoController['create']>) {
  // ctx.body is typed from createTodoSchema; ctx.params from the route.
  // Returning (vs ctx.created) lets typegen infer the response type.
  return reply(201, await this.service.create(ctx.body))
}
\`\`\`

**Red flags**:
- \`new Container()\` — wrong; use \`Container.reset()\` in \`beforeEach\` or \`Container.create()\` for fully isolated graphs.
- \`Container.getInstance().reset()\` — wrong; same fix.
- Sharing a container instance across \`it()\` blocks — leaks registrations between tests.
- Injecting a \`Scope.REQUEST\` service into a \`SINGLETON\` — container throws at resolve. Singletons must resolve request-scoped services explicitly per call.
- Calling \`getRequestValue<string>('traceId')\` — the generic slot is the **key** type, not the value type; widens key and bypasses typed lookup.
- Asserting on \`res.body.requestId\` when \`requestId()\` middleware isn't mounted in the test app — value will be \`undefined\`.
- Using \`Scope.REQUEST\` services in a test without mounting \`requestScopeMiddleware()\` — \`getRequestValue\` silently returns \`undefined\`; \`getRequestStore\` throws.

**Nuances**:
- \`@Inject\` and \`@Autowired\` are interchangeable — same runtime, same types; pick by readability.
- \`@Value('MISSING_KEY')\` with no default **throws on property access**, not at construction — tests that exercise the getter will surface the missing-env issue.`,
    },
    {
      slug: 'env-wiring-check',
      frontmatterName: 'kickjs-env-wiring-check',
      description:
        "Use when ConfigService.get('SOME_KEY') returns undefined or @Value silently falls back to process.env.",
      body: `**Fastest path**: \`kick explain "ConfigService.get('MY_KEY') returned undefined"\` —
pipe a failing run straight in if you prefer (\`pnpm test 2>&1 | kick explain\`). It
distinguishes the entry-file cause from the test-file one, which is the step most
people lose time on. The manual checks below are the same reasoning.

**Diagnosis (in order)**:
1. Open \`src/index.ts\`. The **first non-\`reflect-metadata\`** import MUST be \`import './config'\`.
2. Open \`src/config/index.ts\`. It MUST run the loader as a top-level side effect — not just declare the schema. This is what \`kick new\` generates:
   \`\`\`ts
   import { loadEnvFromSchema } from '@forinda/kickjs/config'
   import { fromZod } from '@forinda/kickjs-schema/zod'
   const envSchema = fromZod(z.object({ DATABASE_URL: z.string().url() }))
   export const env = loadEnvFromSchema(envSchema)
   \`\`\`
   (\`loadEnv(zodSchema)\` from \`@forinda/kickjs\` is the equivalent for a bare Zod
   object. Either is fine — what matters is that it RUNS at module load.)
3. The new key MUST be declared in the Zod schema. \`@Value('NEW_KEY')\` accepts any string at the type level and **falls back to raw \`process.env\`** when the schema doesn't know the key — silently skipping Zod coercion.
4. After adding a key, re-run \`kick typegen\` (or restart \`kick dev\` if the typegen watcher missed it) so the global \`KickEnv\` augmentation picks it up.

5. **In a test?** \`createTestApp\` never loads \`src/index.ts\`, so the entry's
   \`import './config'\` never runs no matter how correct it is. The test file
   must import it itself:
   \`\`\`ts
   import '@/config'
   \`\`\`
   Symptom is identical to the missing-entry-import case, and step 1 will look
   fine, which is what makes it slow to spot.

**Why \`@Value\` "works" but \`ConfigService.get\` doesn't**: \`@Value\` has the \`process.env\` fallback that masks missing-side-effect-import bugs; \`ConfigService\` has none. If \`@Value('FOO')\` returns a value but \`ConfigService.get('FOO')\` returns \`undefined\`, the side-effect import of \`./config\` is missing.

**\`reloadEnv\` vs \`resetEnvCache\`** — distinct, frequently mixed up:
- \`reloadEnv()\` — re-reads \`process.env\` against the **already registered** schema. Use in HMR plugins after \`.env\` file changes. Schema survives.
- \`resetEnvCache()\` — drops the registered schema entirely. **Test-only.** Calling it between dev requests drops the project's keys.

**Nuances**:
- \`loadEnv()\` cache is **sticky**: once \`loadEnv(extendedSchema)\` runs anywhere, no-arg calls reuse it — but only if it actually ran. Schema downgrades silently if \`src/config/index.ts\` isn't imported.
- \`createConfigService(envSchema)\` is deprecated; the typegen-driven \`ConfigService\` covers it.
- \`dotenv\` is an **optional peer dep** in v5+ — projects upgrading from older versions may need to add it explicitly.
- For HMR-friendly \`.env\` edits, add \`envWatchPlugin()\` to \`vite.config.ts\` — calls \`reloadEnv()\` automatically.

**Fix recipe**: add the key to the schema; add \`import './config'\` as the first non-reflect-metadata import in \`src/index.ts\`; add \`import '@/config'\` to any test that reads config; re-run \`kick typegen\`.`,
    },
    {
      slug: 'bootstrap-export',
      frontmatterName: 'kickjs-bootstrap-export',
      description:
        "Use when HMR is silently doing full restarts on every save, or createTestApp can't find the app handle.",
      body: `**Check** \`src/index.ts\`'s last line:

\`\`\`ts
// CORRECT — Vite plugin + createTestApp import the named \`app\` symbol
export const app = await bootstrap({ ... })

// WRONG — HMR degrades to full restart, createTestApp loses the handle
await bootstrap({ ... })
\`\`\`

The Vite plugin imports the named \`app\` symbol via \`virtual:kickjs/app\`; testing helpers do too. Without the export, both fall back to slower paths (full restart on save, mock handle in tests) **without warning**.

**Red flags**:
- A bare \`await bootstrap(...)\` with no \`export\` — fix by adding \`export const app =\`.
- Re-assigning \`app\` later in the file (\`app = somethingElse\`) — Vite imports by reference at module-load time; reassignments don't propagate.
- Multiple files calling \`bootstrap()\` — only the entry should. Tests use \`createTestApp\` instead.`,
    },
    {
      slug: 'thin-entry-file',
      frontmatterName: 'kickjs-thin-entry-file',
      description:
        'Use when src/index.ts is accumulating module/middleware/plugin/adapter literals.',
      body: `**Refactor target**:

\`\`\`ts
// src/modules/index.ts — fluent chain (default for \`modules.style: 'define'\`)
export const modules = defineModules().mount(HelloModule()).mount(UsersModule())
// OR for class-form projects (\`modules.style: 'class'\`):
//   export const modules: AppModuleEntry[] = [HelloModule, UsersModule]

// src/middleware/index.ts — global middleware uses RAW EXPRESS signature
//                            (req, res, next), NOT (ctx, next)
// \`express.json()\` is auto-skipped on Fastify and h3, which parse bodies
// natively — harmless to list, but don't reach for it as the body parser there.
export const middleware = [requestId(), express.json(), helmet(), cors(), traceContext()]

// src/plugins/index.ts
export const plugins = [MetricsPlugin(), AuthPlugin({ tokenTtl: env.TOKEN_TTL })]

// src/adapters/index.ts
export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]

// src/index.ts — stays small
import 'reflect-metadata'
import './config' // MUST be early — side-effect schema load
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { middleware } from './middleware'
import { plugins } from './plugins'
import { adapters } from './adapters'
export const app = await bootstrap({ modules, middleware, plugins, adapters })
\`\`\`

**One-off DI binding** — inline a literal plugin inside \`plugins\`, not a top-level option:

\`\`\`ts
plugins: [
  ...plugins,
  { name: 'vector-store', register(c) { c.registerInstance(VECTOR_STORE, store) } },
]
\`\`\`

**Red flags**:
- Any \`new SomeAdapter()\` / \`SomePlugin()\` literal inside \`bootstrap({ ... })\` instead of imported from a category folder.
- Mixing middleware signatures: \`bootstrap({ middleware })\` is **raw Express** \`(req, res, next)\`; \`@Middleware()\` decorators are \`(ctx, next)\`; adapter middleware is raw Express again. Wrong shape in the wrong slot throws "Cannot read properties of undefined".
- \`bootstrap({ register: ... })\` — that option doesn't exist. Use an inline plugin.`,
    },
    {
      slug: 'context-contributor',
      frontmatterName: 'kickjs-context-contributor',
      description:
        "Use when a middleware's only job is to set ctx values consumed elsewhere — replace with defineHttpContextDecorator (HTTP) or defineContextDecorator (transport-agnostic).",
      body: `**Pattern** (HTTP — most common):

\`\`\`ts
import { defineHttpContextDecorator, type RequestContext } from '@forinda/kickjs'

// Augment ContextMeta — required for ctx.get('tenant') to be typed
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string; name: string }
  }
}

// The \`declare module\` block above is all you need. \`defineAugmentation\` is
// DEPRECATED — it only added a typegen catalogue entry, never any types.

const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO }, // typed DI
  resolve: (ctx, { repo }) => repo.findById(ctx.req.headers['x-tenant-id'] as string),
})

const LoadProject = defineHttpContextDecorator({
  key: 'project',
  dependsOn: ['tenant'], // typo'd key = tsc error
  resolve: (ctx) => projectsRepo.find(ctx.get('tenant')!.id, ctx.params.id),
})

@LoadTenant
@LoadProject
@Get('/projects/:id')
getProject(ctx: RequestContext) {
  return ctx.get('project')
}
\`\`\`

Use \`defineContextDecorator\` (no Http prefix) only when the contributor must run across HTTP, WebSocket, queue, and cron transports — \`Ctx\` defaults to the smaller \`ExecutionContext\` surface (\`get\` / \`set\` / \`requestId\` only, no \`req\`).

**Five precedence levels** (high → low):
**method > class > module > adapter > global**

Same-key collisions WITHIN a precedence level throw \`DuplicateContributorError\`. Across levels, the higher precedence silently overrides — a feature, not a bug, but debug it by giving resolvers distinguishable return values.

**Boot-time validation**:
- Cycles in \`dependsOn\` → \`ContributorCycleError\`.
- \`dependsOn\` referring to an unknown key → \`MissingContributorError\`.
- Both errors fail boot, not first request.

**Critical rules — all stem from the same shared-via-ALS instance model**:
- Every per-request stage (middleware → contributors → handler) gets its OWN \`RequestContext\` instance, but they all read/write the SAME \`AsyncLocalStorage\`-backed bag.
- **\`resolve\` and \`onError\` must RETURN the value** — the runner writes it via \`ctx.set(key, value)\`. Direct property assignment (\`ctx.tenant = …\`) sticks to one instance only and the handler instance never sees it.
- \`ctx.set('tenant', x)\` then \`ctx.get('tenant')\` works across instances. \`ctx.req.headers[...]\` works (the underlying node request is shared). Note it is a node \`IncomingMessage\` on Fastify and h3, not an \`express.Request\`.
- Services with no \`ctx\` reference: \`getRequestValue('tenant')\` returns \`MetaValue<'tenant'> | undefined\` (typed via the augmented \`ContextMeta\`). For \`requestId\` use \`getRequestStore()\`.
- **No \`setRequestValue\` — writes flow through \`ctx.set\` or a contributor's return value.** Avoids "spooky action at a distance" where any service can pollute the per-request bag.

**Error matrix**:
- \`optional: true\` — \`resolve\` throws → key left unset; downstream sees \`ctx.get(key) === undefined\`.
- \`optional: false\` (default) + \`onError\` — return a fallback value to write; return \`undefined\` to skip; throw to forward to the request error handler.
- \`optional: false\` + no \`onError\` — throw propagates straight to the request error handler.

**Don't use this for**: response short-circuit, stream mutation, or pre-route-matching work — keep \`@Middleware()\` for those.

**Red flags**:
- \`ctx.get('key')!\` — the non-null assertion compiles even when the producing decorator isn't on the route. Use \`ctx.require('key')\`.
- \`contributors: [LoadX]\` at a module / adapter / bootstrap site — those take registrations: \`LoadX.registration\` or \`LoadX.with({ ... }).registration\`.
- A \`paramDefaults\` value that every call site overrides (\`action: 'settings:read'\`) — drop it and let the compiler require the field at each site.
- \`defineContextDecorator<'k', Deps, Params>(spec)\` positional form for a parameterised contributor — use \`.withParams<Params>()(spec)\` or \`deps\` inference is lost.
- \`ctx.tenant = x\` instead of returning the value from \`resolve\` — sticks to one instance only.
- Reaching for \`defineAugmentation\` — deprecated, and it never affected types. The \`declare module\` block alone is what makes \`ctx.get('tenant')\` typed.
- Plugin / adapter authors using bare keys (\`'state'\`) instead of namespaced (\`'@my-plugin/state'\`) — collides with adopter keys.
- \`getRequestValue<string>('traceId')\` — generic is the **key** type, not value type.`,
    },
    {
      slug: 'guard-vs-middleware-vs-contributor',
      frontmatterName: 'kickjs-guard-vs-middleware-vs-contributor',
      description:
        'Use when adding auth checks, request-scoped values, or anything "before the handler" — picks between a guard, a middleware, and a context contributor.',
      body: `**KickJS has no guard primitive.** There is no \`@Guard\`, no \`canActivate\`, no guard
class to implement. A guard IS a middleware — the word only names a convention
and a directory. If you are porting NestJS habits, this is the first thing to
unlearn.

| | Guard | Middleware | Context contributor |
|---|---|---|---|
| What it is | a middleware, by convention | a middleware | a declarative value producer |
| Signature | \`(ctx, next)\` | \`(ctx, next)\` on \`@Middleware()\`, \`(req, res, next)\` in \`bootstrap({ middleware })\` | \`resolve(ctx, deps)\` returning a value |
| Can end the request | yes | yes | **no** |
| Runs | in the middleware stage | in the middleware stage | after ALL middleware |
| Attached by | \`@Middleware(fn)\` | \`@Middleware(fn)\` or \`bootstrap({ middleware })\` | \`@LoadX\`, or a registration at module / adapter / bootstrap level |
| Generator | \`kick g guard <name>\` | \`kick g middleware <name>\` | \`kick g contributor <name>\` |
| Lands in | \`src/guards/<name>.guard.ts\` | \`src/middleware/<name>.middleware.ts\` | \`src/contributors/<name>.contributor.ts\` |

Add \`-m <module>\` to any of those generators to place the file inside a module
instead of the app-level directory.

**Choosing**: does the thing ever need to STOP the request?
- Yes, and it is authorization → guard.
- Yes, anything else (rate limit, body rewrite, response stream, work before route matching) → middleware.
- No, it only computes a value the handler or a service reads off \`ctx\` → contributor. Typed, ordered, boot-validated, and it cannot silently swallow the request.

**Ordering — guards run BEFORE contributors.** Every runtime does the same
thing: run \`entry.middlewares\` in order, bail if the response was written,
then run the contributor pipeline, then the handler. So:

\`\`\`ts
// WRONG — tenant is always undefined here.
export async function tenantGuard(ctx: RequestContext, next: () => void) {
  const tenant = ctx.get('tenant') // contributors have not run yet
  if (!tenant) return ctx.problem.forbidden()
  next()
}
\`\`\`

A guard that needs a resolved value must resolve it itself, or the check
belongs in the contributor's own \`resolve\` (throw from there and the request
error handler takes over).

**Write responses with \`ctx.*\`, never \`ctx.res\`.** \`ctx.res\` is the ENGINE-NATIVE
response object, so \`ctx.res.status(401).json(...)\` only works on Express —
\`FastifyReply\` has no \`.json()\` and h3's event has no \`.status()\`. Use
\`ctx.problem.unauthorized({ detail })\` (RFC 9457) or \`ctx.json(body, status)\`;
those work on all four runtimes.

**Guard shape**:

\`\`\`ts
import type { RequestContext } from '@forinda/kickjs'

export async function adminGuard(ctx: RequestContext, next: () => void): Promise<void> {
  const user = ctx.session?.user // requires the session middleware
  if (!user) {
    ctx.problem.unauthorized({ detail: 'Not signed in' })
    return // do NOT call next()
  }
  if (user.role !== 'admin') {
    ctx.problem.forbidden({ detail: 'Admin only' })
    return
  }
  next()
}
\`\`\`

\`\`\`ts
@Middleware(adminGuard)
@Get('/admin/stats')
stats(ctx: RequestContext) { ... }
\`\`\`

Role checks that are purely declarative (\`@Public()\`, \`@Roles('admin')\`,
\`@Can(...)\`) come from \`@forinda/kickjs-auth\` and need its adapter mounted.
Hand-write a guard only for logic those don't express.

**Red flags**:
- \`class AdminGuard implements CanActivate\` / \`@UseGuards()\` — NestJS, not KickJS. Export a \`(ctx, next)\` function and attach with \`@Middleware()\`.
- A guard calling \`next()\` AND writing a response — pick one; writing then continuing double-sends.
- A guard reading \`ctx.get(...)\` for a contributor-produced key — contributors have not run yet.
- \`ctx.res.status(403).json(...)\` in a guard — Express-only. Use \`ctx.problem.forbidden()\`.
- A "guard" that only sets a value and always calls \`next()\` — that is a contributor wearing a guard's name.
- Passing a \`(ctx, next)\` guard to \`bootstrap({ middleware })\` — global middleware is connect-style \`(req, res, next)\`. Mount guards per-route with \`@Middleware()\`.
`,
    },
    {
      slug: 'query-parsing-list-endpoint',
      frontmatterName: 'kickjs-query-parsing-list-endpoint',
      description:
        'Use when adding a paginated/filterable list route — emit ctx.qs + ctx.paginate with an allow-list.',
      body: `**Canonical list endpoint**:

\`\`\`ts
@Get('/')
async list(ctx: Ctx<KickRoutes.TodoController['list']>) {
  const parsed = ctx.qs({
    filterable: ['status', 'priority', 'assigneeId'], // allow-list, MUST be set
    sortable: ['createdAt', 'updatedAt', 'priority'],
    searchColumns: ['title', 'description'], // free-text search targets
  })

  return ctx.paginate(async () => {
    const { data, total } = await this.service.list(parsed)
    return { data, total }
  }, parsed)
}
\`\`\`

**Operator format** (fixed): \`?filter=field:op:value\` where \`op ∈ eq | neq | gt | gte | lt | lte | between | in | contains | starts | ends\`. Sort is \`?sort=field:asc|desc\`. Only the first two colons are delimiters, so timestamps work (\`createdAt:gt:2026-01-01T00:00:00Z\`).

**Drizzle adopters** — pass a \`DrizzleQueryParamsConfig\` with column refs:

\`\`\`ts
const TASK_QUERY_CONFIG = {
  filterable: { status: tasks.status, priority: tasks.priority },
  sortable: { createdAt: tasks.createdAt },
  searchColumns: [tasks.title, tasks.description],
}
const parsed = ctx.qs(TASK_QUERY_CONFIG)
\`\`\`

**ORM-agnostic builders** — implement \`QueryBuilderAdapter<TResult, TConfig>\` with \`build(parsed, config)\`. The Drizzle + Prisma adapters live here.

**Red flags**:
- Reading \`req.query.status\` directly — bypasses the allow-list; opens unbounded filtering. Use \`ctx.qs({ filterable })\`.
- Omitting \`filterable\` / \`sortable\` allow-list — every client-supplied filter is **silently dropped** (security default, but looks like a bug).
- Hand-building the pagination meta in the controller — inconsistent response shape across endpoints. Always use \`ctx.paginate()\`.
- Returning a bare array from a list endpoint when pagination is implied — breaks the \`PaginatedResponse<T>\` contract.
- Mixing string \`searchable\` config with column \`searchColumns\` (Drizzle) — silently no-ops.

**Nuances**:
- \`limit\` is capped at 100 server-side; \`q\` (search) is truncated to 200 chars. Don't re-validate client-side.
- Sort direction defaults to \`asc\` when omitted (\`?sort=createdAt\` ≡ \`?sort=createdAt:asc\`).`,
    },
    {
      slug: 'use-asset-manager',
      frontmatterName: 'kickjs-use-asset-manager',
      description:
        'Use when code reads template files / JSON fixtures via fs.readFile + path arithmetic — switch to assets.<ns>.<key>() and the kick.config.ts assetMap.',
      body: `**Configure** \`kick.config.ts\`:

\`\`\`ts
export default defineConfig({
  assetMap: {
    mails: { src: 'src/templates/mails' },
    reports: { src: 'src/templates/reports', glob: '**/*.{ejs,html}' },
  },
})
\`\`\`

**Consume** via the typed Proxy — no \`__dirname\` arithmetic, dev/prod paths handled:

\`\`\`ts
import { assets } from '@forinda/kickjs'

const html = await assets.mails.welcome() // typed: tsc errors on bad key
\`\`\`

**Class-field decorator** (lazy getter, swappable in tests):

\`\`\`ts
class WelcomeMailService {
  @Asset('mails/welcome') private welcomeTemplate!: () => Promise<string>

  async send(to: string) {
    const body = await this.welcomeTemplate()
  }
}
\`\`\`

**Dynamic dispatch** (CMS templates, codegen) — \`resolveAsset(ns, key)\` throws \`UnknownAssetError\` with \`{ namespace, key }\` fields when the key is missing.

**Test fixtures** — swap via env override + cache clear:

\`\`\`ts
beforeEach(() => {
  process.env.KICK_ASSETS_ROOT = path.resolve('__fixtures__/assets')
  clearAssetCache()
})
afterEach(() => {
  delete process.env.KICK_ASSETS_ROOT
  clearAssetCache()
})
\`\`\`

**Red flags**:
- Hand-rolled \`process.env.NODE_ENV === 'production' ? join(__dirname, '../templates') : join(__dirname, 'templates')\` — exactly what the asset manager replaces.
- \`keys: 'strip'\` setting in \`assetMap.<ns>\` when basenames may collide — silent last-walk-wins data loss. Default \`'auto'\` keeps extensions only for colliding groups.
- Non-default Vite \`outDir\` without mirroring in \`kick.config.ts\` — manifest writes at \`dist/.kickjs-assets.json\` but the resolver can't find it. Mirror via \`build.outDir\`.
- Forgetting to re-run \`kick typegen\` after adding files — \`assets.mails.newTemplate\` is a tsc error even though the file ships. \`kick dev\` does this on-change; one-shot CI builds need \`kick build\` (or \`kick build:assets\` for manifest-only).
- Same-name \`welcome.ejs\` + \`welcome/login.ejs\` — directory wins in the typed surface; the \`.ejs\` file still copies but isn't addressable.

**Nuances**:
- Resolution pipeline (cached): \`KICK_ASSETS_ROOT\` env override > built manifest at \`build.outDir\` / \`dist\` / \`build\` / \`out\` > dev-fallback in-memory walk. Manifest presence = "running from built dist."
- Dev-mode glob matcher is a lite implementation — \`**/*\`, \`**/*.ext\`, \`**/*.{a,b}\` are guaranteed; exotic globs warn-once and accept everything. Run \`kick build:assets\` to exercise the real glob engine.`,
    },
    {
      slug: 'cli-commands-cheatsheet',
      frontmatterName: 'kickjs-cli-commands-cheatsheet',
      description:
        'Use as a quick reference for the most common kick CLI workflows — scaffolding, dev/build/start, generation, inspection.',
      body: `**Top commands**:
- \`kick new <name>\` — start a new project (prompts for template / repo / pm).
- \`kick dev\` — local dev server with Vite HMR.
- \`kick build\` — production bundle via Vite.
- \`kick start\` — run the built artifact (\`NODE_ENV=production\` auto-set).
- \`kick g module <name>\` — add a feature module; structure follows \`pattern\` in \`kick.config.ts\`.
- \`kick g scaffold <Name> <field:type>...\` — full CRUD module from field definitions.
- \`kick g guard <name>\` / \`kick g middleware <name>\` / \`kick g contributor <name>\` — the three "before the handler" shapes. A guard is a middleware by convention, NOT a separate primitive.
- \`kick add <pkg>\` — install optional packages (auto-resolves peer deps + package manager).
- \`kick g --list\` — list every available generator (built-ins + plugin-shipped).
- \`kick info\` — environment / version dump for bug reports.
- \`kick inspect\` — introspect a running app: routes, middleware, adapters, DI graph.

**Useful flag combos**:

\`\`\`bash
kick new my-api --yes                                  # CI-safe: minimal + inmemory, no prompts
kick new my-api -t ddd --pm ${pm} --no-git --install   # Fully scriptable DDD scaffold
kick new . --yes --force                               # Scaffold into current dir, clear existing files
kick g scaffold Post title:string body:text:optional   # Shell-safe optional field syntax
kick g agents -f --only skills                         # Refresh just the skills after upgrade
kick add queue:bullmq                                  # Package + peer deps (bullmq + ioredis) in one shot
kick inspect --port 4000 --json                        # Machine-readable route/adapter dump
kick g config --force --repo postgres                  # Drop a kick.config.ts into a legacy project
\`\`\`

**Lesser-known, high-value**:
- \`kick inspect --watch\` — live route/middleware/adapter table that re-renders on hot reload; faster than re-curling \`/_debug\`.
- \`kick g agents -f\` — regenerates \`CLAUDE.md\` (root) and \`.agents/AGENTS.md\` / \`GEMINI.md\` / \`COPILOT.md\` + every \`.agents/skills/<slug>/SKILL.md\` from the current CLI templates.
- \`kick dev:debug\` — same flags as \`kick dev\` but opens a Node inspector port for IDE attach.
- \`kick list --all\` (alias \`kick ls --all\`) — full optional-package catalog at this CLI version.
- \`kick typegen --watch\` — standalone typegen watcher when \`kick dev\` isn't running.
- \`kick check\` — preflight gate (typecheck + lint + format) before commit.
- \`kick codemod\` — automated AST-level migration between framework versions.

**Red flags**:
- Using globally-installed \`@forinda/kickjs-cli\` while contributing to the monorepo — \`pnpm link --global\` from \`packages/cli\` so generators match the framework.
- Writing \`"name:type?"\` for optional scaffold fields — \`?\` is a shell glob in bash/zsh; use \`name:type:optional\`.
- Running \`kick new <name> --yes\` in a non-empty directory expecting it to wipe — \`--yes\` aborts without \`--force\`; pair them when destruction is intended.
- Skipping \`kick g config\` on a legacy project then wondering why generators ignore \`modules.dir\` / \`modules.repo\`.
- Editing \`kick.config.ts\` with deprecated top-level \`modulesDir\` / \`defaultRepo\` / \`schemaDir\` / \`pluralize\` instead of the nested \`modules\` block.`,
    },
    {
      slug: 'docs-lookup',
      frontmatterName: 'kickjs-docs-lookup',
      description:
        'Use FIRST when unsure about any KickJS API, option, or behaviour — before guessing from memory or inferring from surrounding code.',
      body: `These skills are deliberately short — they cover the traps, not the whole API
surface. When the answer is not in one of them, read the docs rather than
inferring it from nearby code: a wrong guess about a framework API compiles
fine and fails at runtime.

**Where to look**

| Question | Page |
| --- | --- |
| Anything — start here | https://kickjs.app/ |
| Controllers, routing, \`ctx\` helpers | https://kickjs.app/guide/controllers |
| DI, tokens, scopes | https://kickjs.app/guide/dependency-injection |
| Modules and mounting | https://kickjs.app/guide/modules |
| Adapters, plugins, lifecycle hooks | https://kickjs.app/guide/adapters |
| Context Contributors | https://kickjs.app/guide/context-decorators |
| Env, \`ConfigService\`, \`@Value\` | https://kickjs.app/guide/configuration |
| Middleware and guards | https://kickjs.app/guide/middleware |
| Testing (\`createTestApp\`) | https://kickjs.app/guide/testing |
| Typegen and generated types | https://kickjs.app/guide/typegen |
| HMR and the dev server | https://kickjs.app/guide/hmr |

**Local, and usually faster**

- \`kick explain "<error message>"\` — matches known failures and gives the fix.
  Pipe a failing run in: \`${pm} test 2>&1 | kick explain\`.
- \`kick doctor\` — checks this project's wiring.
- \`kick inspect\` — the live route / adapter table.
- \`.kickjs/types/\` — generated types are ground truth for what exists.
- \`node_modules/@forinda/kickjs/dist/*.d.mts\` — the real signature when a doc
  page and the code disagree.

**Rule**: if you would be guessing, look it up. If a doc page contradicts the
installed \`.d.mts\`, trust the \`.d.mts\` and say so — the docs may be behind the
version this project has.`,
    },
    {
      slug: 'refresh-agent-docs',
      frontmatterName: 'kickjs-refresh-agent-docs',
      description:
        'Use after a KickJS version bump to sync the .agents/ docs with the latest CLI templates.',
      body: `**Steps**:
1. \`kick g agents -f --only both\` — overwrites \`CLAUDE.md\` (root) and \`.agents/AGENTS.md\`.
2. \`kick g agents -f --only skills\` — refreshes every \`.agents/skills/<slug>/SKILL.md\`.
3. \`kick g agents -f --only gemini\` / \`--only copilot\` — refresh the per-agent files when needed.
4. Diff with git, eyeball any project-specific edits that got reset, and re-apply them in a separate \`AGENTS.local.md\` or per-skill \`SKILL.local.md\` alongside.
5. Commit as \`docs(agents): sync from CLI vX.Y\`.

**\`.agents/\` layout** (post-restructure):

\`\`\`
CLAUDE.md                 # at root — Claude Code auto-loads from here
.agents/
├── AGENTS.md             # canonical multi-agent reference
├── GEMINI.md             # Gemini-specific notes
├── COPILOT.md            # Copilot CLI notes
└── skills/
    ├── add-module/SKILL.md
    ├── add-adapter/SKILL.md
    └── …                 # one SKILL.md per skill, frontmatter-namespaced
\`\`\`

Customisation goes in \`.local.md\` siblings (\`AGENTS.local.md\`, \`skills/<slug>/SKILL.local.md\`) — those are never overwritten.`,
    },
    {
      slug: 'deny-list',
      frontmatterName: 'kickjs-deny-list',
      description:
        'Patterns to refuse outright when the user asks for them — they break v4 invariants.',
      body: `**Module / adapter / plugin shape**:
- \`class implements AppAdapter\` → use \`defineAdapter()\`.
- \`class implements KickPlugin\` / function returning \`KickPlugin\` → use \`definePlugin()\`.
- \`class implements AppModule\` for new code → use \`defineModule()\`.
- \`bootstrap({ adapters: [MyAdapter] })\` (factory) → \`MyAdapter()\` (instance, with parens).
- \`@Controller('/path')\` with a path argument → drop the path; set the mount via \`routes().path\`. The decorator path is OpenAPI metadata only.
- Module file named \`<name>.ts\` (no \`.module\` suffix) → rename to \`<name>.module.ts\`. Vite HMR's glob doesn't pick up the unsuffixed form.

**DI**:
- \`new Container()\` or \`Container.getInstance().reset()\` in tests → use \`Container.reset()\` in \`beforeEach\` (or \`Container.create()\` for fully isolated graphs).
- DI tokens with \`:\` separator (\`'app:db:url'\`) or in PascalCase → use slash-delimited lower-case (\`'app/db/url'\`). First-party uses reserved \`'kick/'\` prefix.
- \`Symbol.for(...)\` for DI tokens — globally interned, **collides across files**. Use \`createToken<T>('name')\`.
- Raw string tokens (\`@Inject('config')\`) — silent collisions; widens to \`unknown\`. Use \`createToken<T>\`.
- Injecting a \`Scope.REQUEST\` service into a \`SINGLETON\` — container throws at resolve time.

**Bootstrap / entry file**:
- \`bootstrap({ ... })\` without \`export const app = ...\` → always export. HMR degrades to full restart and \`createTestApp\` loses the handle.
- \`bootstrap({ register: ... })\` — that option doesn't exist. Use an inline plugin in \`plugins\`.

**Middleware**:
- Using \`(ctx, next)\` for global middleware in \`bootstrap({ middleware })\` — global middleware uses raw Express \`(req, res, next)\`. Wrong signature throws "Cannot read properties of undefined".
- Using \`(req, res, next)\` for an \`@Middleware()\` decorator — those use \`(ctx, next)\`.
- \`@Middleware()\` whose only output is \`ctx.set('x', v)\` — should be a context decorator (typed, ordered, testable).

**Context contributors**:
- \`ctx.tenant = x\` from a contributor — only sticks to one \`RequestContext\` instance. **Return the value** so the runner writes it via \`ctx.set(key, value)\`.
- Omitting the \`declare module '@forinda/kickjs'\` block — without it \`ctx.get('tenant')\` is \`unknown\`. (\`defineAugmentation\` is deprecated and was never a substitute for it.)
- \`getRequestValue<string>('traceId')\` — generic is the **key** type, not value type.

**Env / config**:
- \`@Value('NEW_KEY')\` without the key in the Zod schema — silent fallback to raw \`process.env\`, no coercion.
- \`resetEnvCache()\` outside tests — drops the registered schema.

**List endpoints**:
- Reading \`req.query.status\` directly — bypasses the allow-list. Use \`ctx.qs({ filterable })\`.
- Returning a bare array from a list endpoint — breaks the \`PaginatedResponse<T>\` contract. Use \`ctx.paginate()\`.

**Assets**:
- Hand-rolled \`__dirname\` arithmetic for template paths — use \`assets.<ns>.<key>()\` and add the namespace to \`kick.config.ts assetMap\`.`,
    },
  ]

  return skills
}

export function generateKickJsSkillFiles(
  name: string,
  _template: ProjectTemplate,
  pm: string,
): KickJsSkillFile[] {
  const banner = `<!-- Generated by \`kick g agents\` for ${name}. Edits are overwritten on the next refresh; keep customisation in a SKILL.local.md alongside. -->`

  const skills = buildSkills(pm)

  return skills.map((skill) => ({
    slug: skill.slug,
    content: `---
name: ${skill.frontmatterName}
description: ${skill.description}
---

${banner}

${skill.body}
`,
  }))
}

/**
 * @deprecated Kept only for back-compat with adopters who programmatically
 * import this function from `@forinda/kickjs-cli`. The CLI itself no
 * longer calls it — `kick g agents` emits per-skill SKILL.md files via
 * {@link generateKickJsSkillFiles}. Will be removed in a future minor.
 */
export function generateGemini(name: string, _template: ProjectTemplate, _pm: string): string {
  return `# GEMINI.md — ${name}

**Read \`./AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project — every convention, structure, decorator
pattern, env wiring rule, generator usage. This file is a thin
Gemini-specific layer; when the two disagree on anything substantive,
treat \`AGENTS.md\` as authoritative and flag the discrepancy.

## Why this file

Gemini CLI auto-loads \`GEMINI.md\` when it lives alongside the
agent-context files. Keeping it in \`.agents/\` next to \`AGENTS.md\`
means Gemini reads the same shared prose as Codex / Cursor / Copilot
without us copy-pasting.

## Gemini-specific notes

- **Skills activation** — Gemini activates skills via
  \`activate_skill\` (its native MCP-style tool); the equivalent on
  Claude Code is the \`Skill\` tool. Cross-reference the
  \`kickjs-skills.md\` index for the available triggers.
- **Tool naming** — Gemini's tool names differ from Claude Code's
  (e.g. \`read_file\` vs \`Read\`, \`run_terminal_command\` vs
  \`Bash\`). The shared prose in \`AGENTS.md\` describes intents, not
  tool names; consult Gemini's docs for the concrete invocation.
- **File ops** — Gemini's file edits are sandboxed; large refactors
  may need explicit confirmation. Prefer the smallest-possible-edit
  pattern.

## Refreshing this file

\`kick g agents --only gemini -f\` regenerates this file from the
CLI template. Hand-edited content is overwritten — keep customisation
in \`.agents/GEMINI.local.md\`.
`
}

/**
 * Render the GitHub Copilot CLI agent file emitted at
 * `.agents/COPILOT.md`. Same pattern as `generateGemini` — thin
 * pointer to `.agents/AGENTS.md` with notes specific to Copilot
 * CLI's tool surface and conventions.
 */
export function generateCopilot(name: string, _template: ProjectTemplate, _pm: string): string {
  return `# COPILOT.md — ${name}

**Read \`./AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project — every convention, structure, decorator
pattern, env wiring rule, generator usage. This file is a thin
Copilot-specific layer; when the two disagree on anything substantive,
treat \`AGENTS.md\` as authoritative and flag the discrepancy.

## Why this file

GitHub Copilot CLI auto-loads \`COPILOT.md\` when it lives alongside
the agent-context files. Keeping it in \`.agents/\` next to
\`AGENTS.md\` means Copilot reads the same shared prose as
Codex / Cursor / Gemini / Claude Code without copy-pasting.

## Copilot-specific notes

- **Skills** — Copilot CLI auto-discovers skills from installed
  plugins; cross-reference \`kickjs-skills.md\` for available
  triggers in this project.
- **Tool naming** — Copilot's tool names differ from Claude Code's
  (\`edit\` vs \`Edit\`, \`shell\` vs \`Bash\`, etc.). The shared
  prose in \`AGENTS.md\` describes intents, not tool names; consult
  Copilot's docs for the concrete invocation.
- **Confirmation flows** — Copilot CLI surfaces destructive
  operations through an explicit approval gate. Stage edits with
  short, focused diffs so each one is easy to review at the prompt.

## Refreshing this file

\`kick g agents --only copilot -f\` regenerates this file from the
CLI template. Hand-edited content is overwritten — keep customisation
in \`.agents/COPILOT.local.md\`.
`
}
