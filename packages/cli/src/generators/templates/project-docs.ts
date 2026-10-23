import { execBin, runScript, type PackageManager } from '../../config'
import type { ModuleStyle } from './types'
import { readLayerSkills, skillVars } from '../../scaffold/skills'

/** How to start the dev server: a non-pnpm fullstack root has `dev:server` and `dev:web`, no `dev`. */
function devCommand(pm: string, template: ProjectTemplate): string {
  const p = pm as PackageManager
  return template === 'fullstack' && p !== 'pnpm'
    ? `${runScript(p, 'dev:server')} + ${runScript(p, 'dev:web')}`
    : runScript(p, 'dev')
}
type ProjectTemplate = 'rest' | 'minimal' | 'fullstack' | 'inertia'

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
export function generateClaude(name: string, template: ProjectTemplate, pm: string): string {
  return `# CLAUDE.md — ${name}

**Read \`./.agents/AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project (Claude, Copilot, Codex, Gemini, etc.) —
project conventions, structure, decorator patterns, env wiring, CLI
generators, every gotcha.

**Skills, when you want them:** \`kick g agents --only skills\` writes
\`./.agents/skills/\` — one task-oriented skill per subdirectory
(\`add-module/\`, \`write-controller-test/\`, \`bootstrap-export/\`,
\`deny-list/\`, …), each a \`SKILL.md\` with YAML frontmatter (\`name\`,
\`description\`) and the recipe body. The structure follows the Claude
Code skills convention — agents that auto-load skills from
\`.agents/skills/\` pick each up by its frontmatter. \`kick g agents\`
alone also adds \`GEMINI.md\` and \`COPILOT.md\`.

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
${pm} install
${devCommand(pm, template)}     # Dev server with HMR + typegen
${runScript(pm as PackageManager, 'build')} && ${runScript(pm as PackageManager, 'start')}  # Production
${runScript(pm as PackageManager, 'test')}    # Vitest
${template === 'fullstack' ? runScript(pm as PackageManager, 'typecheck') : `${execBin(pm as PackageManager, 'kick')} typecheck`}   # tsc/tsgo, whichever the project has
${template === 'fullstack' ? runScript(pm as PackageManager, 'format') : `${execBin(pm as PackageManager, 'kick')} format`}      # oxfmt
\`\`\`

\`kick\` is this project's dev dependency, not a global command: every \`kick …\`
in these docs runs as \`${execBin(pm as PackageManager, 'kick')} …\` in a shell.

## v4 framework reminders

When generating or modifying code in this project, stay aligned with the v4 conventions documented in \`.agents/AGENTS.md\`:

- **Adapters**: \`defineAdapter()\` factory — never \`class implements AppAdapter\`.
- **Plugins**: \`definePlugin()\` factory — never plain function returning \`KickPlugin\`.
- **DI tokens**: \`<scope>/<area>/<key>[:<instance>]\` — a lowercase scope, then slash-separated segments (e.g. \`'app/users/repository'\`, \`'app/Users/repository'\`, \`'mycorp/cache/redis'\`). First-party uses the reserved \`'kick/'\` prefix; this project owns its own scope.
- **Decorators**: \`@Controller()\` (no path arg — mount prefix comes from \`routes().path\`).
- **HTTP runtime**: this app may run on Express, Fastify, or h3 — check \`kick.config.ts\` \`runtime\` (or \`bootstrap({ runtime })\`) before writing engine-specific code. Prefer engine-neutral \`ctx\` APIs (\`ctx.json\`/\`ctx.body\`/\`ctx.params\`/\`ctx.sse\`); don't assume \`ctx.req\` is an Express request. Uploads (\`@FileUpload\` → \`ctx.file\`/\`ctx.files\`) work on all three (\`kick add upload\` installs the driver). Full rules in \`.agents/AGENTS.md\` → "HTTP runtime".
- **Module entry file** MUST be named \`<name>.module.ts\` and live under \`src/modules/<name>/\`. The Vite plugin auto-discovers \`*.module.[tj]sx?\` for graceful HMR — a misnamed \`projects.ts\` silently degrades every save into a full restart.
- **Env**: schema lives in \`src/config/index.ts\`; \`import './config'\` MUST be the first import in \`src/index.ts\` (side-effect registers the schema before any \`@Value\` resolves).
- **Assets**: drop new template files into \`src/templates/<namespace>/\`; the dev watcher auto-rebuilds the \`KickAssets\` augmentation + \`assets.x.y()\` re-walks on next call. No restart, no manual build.
- **Context Contributors** (\`defineContextDecorator\`) over \`@Middleware()\` for ctx-population work.
- **Repos under tests**: \`Container.create()\` for isolation — never \`new Container()\` or \`getInstance().reset()\`.
- **Bootstrap export**: \`src/index.ts\` must end with \`export const app = await bootstrap({ ... })\`. The Vite plugin and \`createTestApp\` import the named \`app\`; without the export, HMR silently degrades to full restarts.
- **Thin entry file**: aggregate \`modules\`, \`middlewares\`, \`plugins\`, \`adapters\` in their own folders (\`src/modules/index.ts\`, \`src/middleware/index.ts\`, …) and pass them by name to \`bootstrap()\` — never inline the lists in \`src/index.ts\`.
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
2. Run \`${devCommand(pm, template)}\` to verify the app starts

\`kick\` is this project's dev dependency, not a global command: every \`kick …\`
below runs as \`${execBin(pm as PackageManager, 'kick')} …\` in a shell.${
    template === 'fullstack'
      ? `

## Fullstack workspace layout

This is a WORKSPACE root — the KickJS API lives in \`server/\`, the typed web
app in \`web/\`. Run both with \`${devCommand(pm, template)}\`. From this root,
\`${runScript(pm as PackageManager, 'test')}\`, \`${runScript(pm as PackageManager, 'typecheck')}\` and \`${runScript(pm as PackageManager, 'format')}\` reach into
\`server/\` (and \`web/\` for typecheck).

The type loop (do not break it):
1. \`server/\` handlers RETURN their payloads → \`kick typegen\` emits
   \`server/.kickjs/types/kick__client.d.ts\`: the ambient \`KickClientApi\`
   namespace, every response resolved to a plain shape. \`kick dev\` writes it
   at startup but NOT on save — run \`kick typegen\` in \`server/\` after changing a route or a
   response (the root \`build\` script runs it too).
2. \`web/tsconfig.json\` lists that file in \`compilerOptions.types\`.
3. \`web/src/api.ts\` = \`createClient<KickClientApi.Api>({ baseUrl })\`
   — every call site is typed from the server's handlers. \`baseUrl\` is the
   relative \`/api/v1\` (Vite proxies it in dev) unless \`VITE_API_URL\` points at
   an API on another origin.

Rules: kick commands (\`kick g\`, \`kick typegen\`, \`kick dev\`, \`kick typecheck\`)
run in \`server/\` — the root has no \`kick.config.ts\`; never import server runtime code into \`web/\` (the d.ts bridge is
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
- **Global middleware** in \`bootstrap({ middlewares })\` is connect-style
  \`(req, res, next)\` — it runs on all engines (Fastify via \`@fastify/middie\`,
  h3 via \`fromNodeHandler\`). But on Fastify / h3 the engine parses the body
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

- **DI tokens** — \`<scope>/<area>/<key>[:<instance>]\`. The scope is
  lowercase; the segments after it are identifiers (\`kick typegen\` warns
  on names that don't fit — a bare \`'UserRepository'\`, a dotted
  \`'app.db'\`):

  \`\`\`ts
  const USERS_REPO = createToken<UsersRepo>('app/Users/repository')
  const DB         = createToken<Database>('app/Db/connection')
  \`\`\`

  The \`kick/\` prefix is reserved for first-party packages; this project
  owns its own scope (\`app/\`, your domain name, etc.).

- **\`@Controller()\`** takes **no arguments**. Set the route prefix with the
  module's \`routes().path\`.

- **Env** — the schema lives in \`src/config/index.ts\`. \`src/index.ts\` imports
  it once, as its **first** import (\`import './config'\`, before \`bootstrap()\`);
  tests that read config import it too (\`import '@/config'\`). Nothing else
  imports from \`src/config\`: read values with \`getEnv('KEY')\`, an injected
  \`ConfigService\` (\`config.get('KEY')\`), or \`@Value('KEY')\` typed as
  \`Env<'KEY'>\` — never \`process.env\`. Add a key to the schema before reading it.
  A concern with several keys (a database, a mail provider) gets a typed section
  instead: \`defineSettings('DB', schema)\` in the module's own
  \`<name>.settings.ts\` — not in \`src/config\` — declared by the module that
  needs it (\`settings: () => [DbSettings]\`) and read through
  \`@Inject(DbSettings)\` or \`DbSettings.get()\`. Its variables are \`DB_*\`.

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

  export const app = await bootstrap({ modules, middlewares, plugins, adapters })
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
├── <name>.repository.ts     # Data access — factory + contract + token
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
| Flag a route (public, exempt, unmetered) | \`kickjs-route-flags\` |
| Add a kick CLI command or generator | \`kickjs-cli-plugin\` |
| Deploy to Netlify / Vercel / Cloudflare | \`kickjs-deploy\` |
| Server-rendered pages with \`.kick\` views | \`kickjs-views\` |
| HTML forms: errors, flash, browser checks, CSRF | \`kickjs-views-forms\` |
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
export function generateKickJsSkillFiles(
  name: string,
  _template: ProjectTemplate,
  pm: string,
  style: ModuleStyle = 'define',
  /** Feature layers the app uses (`feature-views`, …): their skills join the base ones. */
  layers: readonly string[] = [],
): KickJsSkillFile[] {
  const banner = `<!-- Generated by \`kick g agents\` for ${name}. Edits are overwritten on the next refresh; keep customisation in a SKILL.local.md alongside. -->`

  const skills = readLayerSkills(['base', ...layers], skillVars(pm, style))

  return skills.map((skill) => ({
    slug: skill.slug,
    content: `---
name: ${skill.name}
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
