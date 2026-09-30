// `kick build:netlify` / `kick build:vercel` — bundle the serverless entry
// with the same Vite + SWC setup as `kick build`, then write the platform's
// build output around it.
//
// The bundle is one self-contained ESM file: a Vercel function cannot see
// node_modules outside its own directory, and Netlify must not re-compile the
// TypeScript (its esbuild pass drops `emitDecoratorMetadata`, which silently
// breaks constructor injection).

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Command } from 'commander'
import { parseSync } from 'oxc-parser'
import type { DeployConfig } from '../config'
import type { KickCliPluginContext } from '../plugin/types'

/** Deploy settings with every default filled in. */
export interface ResolvedDeploy {
  entry: string
  outDir: string
  /** Built frontend published next to the API; absent for an API-only project. */
  staticDir?: string
  /** Directory the platform deploys from, relative to the project. */
  siteRoot: string
  /** Empty directory Netlify publishes when there is no frontend. */
  publishDir: string
  /** URL prefix routed to the function; `''` gives it every path. */
  apiPath: string
  external: string[]
  vercelRuntime: string
}

/**
 * Fullstack layout: this project is a workspace member with a sibling `web`
 * package. Its build is what the platform publishes, and `.netlify/` /
 * `.vercel/` belong at the workspace root above both.
 */
export function detectLayout(
  root: string,
  exists: (path: string) => boolean = existsSync,
): Pick<ResolvedDeploy, 'siteRoot' | 'apiPath'> & { staticDir?: string } {
  const parent = dirname(root)
  const isWorkspaceRoot =
    exists(resolve(parent, 'pnpm-workspace.yaml')) || exists(resolve(parent, 'package.json'))
  if (isWorkspaceRoot && exists(resolve(parent, 'web', 'package.json'))) {
    return { staticDir: '../web/dist', siteRoot: '..', apiPath: '/api' }
  }
  // API only: nothing else serves this domain, so the function takes every
  // path and unknown routes get the app's own 404 rather than the platform's.
  return { siteRoot: '.', apiPath: '' }
}

/** Merge the `deploy` config block over the detected layout. */
export function resolveDeploy(
  config: DeployConfig | undefined,
  root: string,
  exists?: (path: string) => boolean,
): ResolvedDeploy {
  const detected = detectLayout(root, exists)
  const staticDir =
    config?.staticDir === false ? undefined : (config?.staticDir ?? detected.staticDir)
  return {
    entry: config?.entry ?? 'src/serverless.ts',
    outDir: config?.outDir ?? 'dist/serverless',
    staticDir,
    siteRoot: config?.siteRoot ?? detected.siteRoot,
    publishDir: config?.publishDir ?? 'dist/public',
    apiPath: config?.apiPath ?? detected.apiPath,
    external: config?.external ?? ['valibot', 'yup'],
    vercelRuntime: config?.vercelRuntime ?? 'nodejs22.x',
  }
}

/**
 * The Netlify function. `config` has to be a literal — Netlify reads it
 * without running the file — and carries no `preferStatic`: with it, a SPA
 * rewrite counts as a static match and every API path returns `index.html`.
 */
export function netlifyFunctionSource(bundleImport: string, apiPath: string): string {
  return `import { handler } from '${bundleImport}'

// Netlify's context carries waitUntil, so ctx.waitUntil() work finishes after the response.
export default (request, context) => handler.fetch(request, context)

export const config = {
  path: '${apiPath}/*',
}
`
}

/**
 * The Vercel function entry. Vercel's Node runtime passes no per-request
 * context argument; it exposes the request context — `waitUntil` included —
 * on a global, per request (the channel `@vercel/functions` reads). Absent
 * outside Vercel, so the handler just gets `undefined`.
 */
export function vercelFunctionSource(): string {
  return `import { handler } from './server.mjs'

const requestContext = () => globalThis[Symbol.for('@vercel/request-context')]?.get?.()

export default (req, res) => handler.node(req, res, requestContext())
`
}

/** The `publish` directory declared in a netlify.toml, if it declares one. */
export function netlifyPublishDir(toml: string): string | undefined {
  const match = /^\s*publish\s*=\s*["']([^"']+)["']/m.exec(toml)
  return match?.[1]?.replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * Vercel Build Output API routes: files first, then the function, then the SPA
 * shell. With crons, `/_kick/*` (the cron trigger) goes to the function too
 * when the API path doesn't already cover it.
 */
export function vercelRoutes(
  apiPath: string,
  hasStatic: boolean,
  hasCrons = false,
): Array<Record<string, string>> {
  const routes: Array<Record<string, string>> = [
    { handle: 'filesystem' },
    { src: `^${apiPath}/(.*)$`, dest: '/api' },
  ]
  if (hasCrons && apiPath !== '') routes.push({ src: '^/_kick/(.*)$', dest: '/api' })
  if (hasStatic) routes.push({ src: '^/(.*)$', dest: '/index.html' })
  return routes
}

/** One `@Cron(...)` found in source. `expression` is absent when it isn't a literal. */
export interface FoundCron {
  file: string
  line: number
  expression?: string
  timezone: boolean
}

/** Every `@Cron(...)` decorator in a file, read from the AST. */
export function findCronDecorators(source: string, file: string): FoundCron[] {
  let program: unknown
  try {
    program = parseSync(file, source).program
  } catch {
    return []
  }
  const found: FoundCron[] = []
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const n = node as Record<string, any>
    const call = n.expression
    if (
      n.type === 'Decorator' &&
      call?.type === 'CallExpression' &&
      call.callee?.type === 'Identifier' &&
      call.callee.name === 'Cron'
    ) {
      const [expr, options] = call.arguments ?? []
      const literal =
        expr?.type === 'Literal' && typeof expr.value === 'string'
          ? expr.value
          : expr?.type === 'TemplateLiteral' && expr.expressions.length === 0
            ? expr.quasis[0]?.value?.cooked
            : undefined
      found.push({
        file,
        line: lineOf(n.start ?? 0),
        expression: literal,
        timezone:
          options?.type === 'ObjectExpression' &&
          options.properties.some((p: any) => (p.key?.name ?? p.key?.value) === 'timezone'),
      })
    }
    for (const key in n) if (key !== 'parent') visit(n[key])
  }
  visit(program)
  return found
}

/** `@Cron` decorators across the project's `src/`. */
function scanCrons(root: string): FoundCron[] {
  const src = resolve(root, 'src')
  if (!existsSync(src)) return []
  return readdirSync(src, { recursive: true, encoding: 'utf-8' })
    .filter((f) => /\.m?ts$/.test(f) && !/\.(test|spec|d)\.m?ts$/.test(f))
    .flatMap((f) => {
      const source = readFileSync(resolve(src, f), 'utf-8')
      return source.includes('@Cron') ? findCronDecorators(source, `src/${f}`) : []
    })
}

/**
 * Same hash as `cronScheduleId` in `@forinda/kickjs` (a parity test keeps
 * them equal) — the app answers `/_kick/cron/<id>` for the jobs on that
 * expression. Copied rather than imported so the CLI doesn't load the framework.
 */
export function cronScheduleId(expression: string): string {
  let hash = 0x811c9dc5
  for (const char of expression.trim().replace(/\s+/g, ' ')) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Vercel `crons` entries — one per distinct expression — plus warnings for what can't run there. */
export function vercelCrons(found: FoundCron[]): {
  crons: Array<{ path: string; schedule: string }>
  warnings: string[]
} {
  const warnings: string[] = []
  const schedules = new Map<string, string>()
  for (const cron of found) {
    const at = `${cron.file}:${cron.line}`
    if (cron.expression === undefined) {
      warnings.push(
        `${at}: @Cron expression is not a string literal, so it has no Vercel cron entry`,
      )
      continue
    }
    if (cron.timezone) {
      warnings.push(`${at}: Vercel crons run in UTC — the timezone option is ignored there`)
    }
    const id = cronScheduleId(cron.expression)
    schedules.set(id, cron.expression.trim().replace(/\s+/g, ' '))
  }
  return {
    crons: [...schedules].map(([id, schedule]) => ({ path: `/_kick/cron/${id}`, schedule })),
    warnings,
  }
}

/**
 * The file an ESM `import` of this package resolves to. `require.resolve`
 * can't answer that: `@forinda/kickjs-vite` and other ESM-only packages
 * export a bare `import` condition and no CJS entry, and resolving them
 * through `createRequire` throws `No "exports" main defined`.
 */
export function packageEntry(pkg: Record<string, unknown>): string | undefined {
  const pick = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value
    if (!value || typeof value !== 'object') return undefined
    const conditions = value as Record<string, unknown>
    for (const key of ['import', 'module', 'node', 'default']) {
      const found = pick(conditions[key])
      if (found) return found
    }
    return undefined
  }
  const exports = pkg.exports as Record<string, unknown> | string | undefined
  const root =
    typeof exports === 'string' || Array.isArray(exports) ? exports : (exports?.['.'] ?? exports)
  return pick(root) ?? (pkg.module as string) ?? (pkg.main as string)
}

/** Load a package from the user's project, not from the CLI's own node_modules. */
async function importFromProject(root: string, specifier: string): Promise<any> {
  const { createRequire } = await import('node:module')
  const require = createRequire(resolve(root, 'package.json'))
  let manifest: string
  try {
    manifest = require.resolve(`${specifier}/package.json`)
  } catch {
    // Package.json isn't always exported; find it beside the resolved entry.
    manifest = resolve(root, 'node_modules', specifier, 'package.json')
  }
  if (!existsSync(manifest)) {
    throw new Error(
      `${specifier} is not installed in this project. Run: pnpm add -D vite unplugin-swc @forinda/kickjs-vite`,
    )
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf-8')) as Record<string, unknown>
  const entry = packageEntry(pkg)
  if (!entry) throw new Error(`${specifier} has no importable entry point`)
  return import(pathToFileURL(resolve(dirname(manifest), entry)).href)
}

/** Build `<outDir>/server.mjs`, returning its absolute path. */
async function bundle(root: string, deploy: ResolvedDeploy, log: (msg: string) => void) {
  const entry = resolve(root, deploy.entry)
  if (!existsSync(entry)) {
    throw new Error(
      `${deploy.entry} not found. The serverless entry exports ` +
        `\`handler = createHandler({ modules })\` — see the Serverless guide.`,
    )
  }
  const { build } = await importFromProject(root, 'vite')
  const { default: swc } = await importFromProject(root, 'unplugin-swc')
  const { devtoolsFlagPlugin, devtoolsStripPlugin } = await importFromProject(
    root,
    '@forinda/kickjs-vite',
  )

  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    oxc: false,
    plugins: [swc.vite(), devtoolsFlagPlugin(), devtoolsStripPlugin()],
    resolve: { alias: { '@': resolve(root, 'src') } },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: true,
      target: 'node20',
      outDir: resolve(root, deploy.outDir),
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: entry,
        // Inlined, a missing optional peer becomes a stub that throws on load;
        // left external, an installed one is unreachable from the function.
        external: deploy.external.filter(
          (name) => !existsSync(resolve(root, 'node_modules', name)),
        ),
        output: { format: 'esm', entryFileNames: 'server.mjs', codeSplitting: false },
      },
    },
  })
  const file = resolve(root, deploy.outDir, 'server.mjs')
  log(`bundled ${relative(process.cwd(), file)}`)
  return file
}

export function registerDeployCommands(program: Command, ctx: KickCliPluginContext): void {
  const root = ctx.projectRoot
  const deploy = () => resolveDeploy(ctx.config?.deploy, root)

  program
    .command('build:netlify')
    .description('Bundle the serverless entry and write the Netlify function')
    .action(async () => {
      const options = deploy()
      const server = await bundle(root, options, ctx.log)
      const siteRoot = resolve(root, options.siteRoot)

      const crons = scanCrons(root)
      if (crons.length > 0) {
        ctx.log(
          `warning: ${crons.length} @Cron job(s) found — Netlify has no cron trigger for them, ` +
            'so they will not run. Use Netlify scheduled functions, or deploy to Vercel or Workers.',
        )
      }

      const functions = resolve(siteRoot, '.netlify/v1/functions')
      mkdirSync(functions, { recursive: true })
      // The function imports the bundle; Netlify packages what it imports.
      const from = relative(functions, server).split(sep).join('/')
      writeFileSync(resolve(functions, 'api.mjs'), netlifyFunctionSource(from, options.apiPath))
      ctx.log(`wrote ${relative(process.cwd(), resolve(functions, 'api.mjs'))}`)

      // Netlify publishes *something*; with no frontend that has to be an
      // empty directory, or it serves the project's own files — and those
      // shadow the function.
      const publish = options.staticDir ?? options.publishDir
      if (!options.staticDir) {
        mkdirSync(resolve(root, publish), { recursive: true })
        ctx.log(`publish directory ready at ${relative(process.cwd(), resolve(root, publish))}`)
      }

      // netlify.toml is written once by `kick new` and edited by hand after;
      // a `publish` that no longer matches these settings deploys the wrong
      // directory, which is a broken site rather than a failed build.
      const toml = resolve(siteRoot, 'netlify.toml')
      if (existsSync(toml)) {
        const declared = netlifyPublishDir(readFileSync(toml, 'utf-8'))
        const expected = relative(siteRoot, resolve(root, publish)).split(sep).join('/')
        if (declared !== undefined && declared !== expected) {
          ctx.log(
            `warning: netlify.toml publishes "${declared}", but this build fills "${expected}". ` +
              `Update netlify.toml, or set \`deploy.publishDir\` / \`deploy.staticDir\` to match.`,
          )
        }
      }
    })

  program
    .command('build:vercel')
    .description('Bundle the serverless entry and write .vercel/output (Build Output API v3)')
    .action(async () => {
      const options = deploy()
      const server = await bundle(root, options, ctx.log)
      const siteRoot = resolve(root, options.siteRoot)
      const staticDir = options.staticDir ? resolve(root, options.staticDir) : undefined

      const output = resolve(siteRoot, '.vercel/output')
      const fn = resolve(output, 'functions/api.func')
      rmSync(output, { recursive: true, force: true })
      mkdirSync(fn, { recursive: true })

      // Nothing outside the .func directory is visible at runtime.
      cpSync(server, resolve(fn, 'server.mjs'))
      writeFileSync(resolve(fn, 'index.mjs'), vercelFunctionSource())
      writeFileSync(
        resolve(fn, '.vc-config.json'),
        `${JSON.stringify(
          {
            runtime: options.vercelRuntime,
            handler: 'index.mjs',
            launcherType: 'Nodejs',
            supportsResponseStreaming: true,
          },
          null,
          2,
        )}\n`,
      )

      if (staticDir) {
        if (!existsSync(staticDir)) {
          throw new Error(
            `build:vercel: ${options.staticDir} does not exist — build the frontend first`,
          )
        }
        cpSync(staticDir, resolve(output, 'static'), { recursive: true })
      }
      const { crons, warnings } = vercelCrons(scanCrons(root))
      for (const warning of warnings) ctx.log(`warning: ${warning}`)
      const config = {
        version: 3,
        routes: vercelRoutes(options.apiPath, Boolean(staticDir), crons.length > 0),
        ...(crons.length > 0 ? { crons } : {}),
      }
      writeFileSync(resolve(output, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
      ctx.log(`wrote ${relative(process.cwd(), output)}`)
      if (crons.length > 0) {
        ctx.log(
          `${crons.length} cron schedule(s) written. Set CRON_SECRET in the Vercel project — ` +
            'the trigger is not mounted without it.',
        )
      }
    })
}
