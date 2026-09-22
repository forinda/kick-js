// `kick build:netlify` / `kick build:vercel` — bundle the serverless entry
// with the same Vite + SWC setup as `kick build`, then write the platform's
// build output around it.
//
// The bundle is one self-contained ESM file: a Vercel function cannot see
// node_modules outside its own directory, and Netlify must not re-compile the
// TypeScript (its esbuild pass drops `emitDecoratorMetadata`, which silently
// breaks constructor injection).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Command } from 'commander'
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

export default (request) => handler.fetch(request)

export const config = {
  path: '${apiPath}/*',
}
`
}

/** Vercel Build Output API routes: files first, then the function, then the SPA shell. */
export function vercelRoutes(apiPath: string, hasStatic: boolean): Array<Record<string, string>> {
  const routes: Array<Record<string, string>> = [
    { handle: 'filesystem' },
    { src: `^${apiPath}/(.*)$`, dest: '/api' },
  ]
  if (hasStatic) routes.push({ src: '^/(.*)$', dest: '/index.html' })
  return routes
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

      const functions = resolve(siteRoot, '.netlify/v1/functions')
      mkdirSync(functions, { recursive: true })
      // The function imports the bundle; Netlify packages what it imports.
      const from = relative(functions, server).split(sep).join('/')
      writeFileSync(resolve(functions, 'api.mjs'), netlifyFunctionSource(from, options.apiPath))
      ctx.log(`wrote ${relative(process.cwd(), resolve(functions, 'api.mjs'))}`)

      if (!options.staticDir) {
        // Netlify publishes *something*; without an empty directory it serves
        // the project's own files, which would shadow the function.
        const publish = resolve(root, options.publishDir)
        mkdirSync(publish, { recursive: true })
        ctx.log(`publish directory ready at ${relative(process.cwd(), publish)}`)
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
      writeFileSync(
        resolve(fn, 'index.mjs'),
        `import { handler } from './server.mjs'\nexport default handler.node\n`,
      )
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
      writeFileSync(
        resolve(output, 'config.json'),
        `${JSON.stringify({ version: 3, routes: vercelRoutes(options.apiPath, Boolean(staticDir)) }, null, 2)}\n`,
      )
      ctx.log(`wrote ${relative(process.cwd(), output)}`)
    })
}
