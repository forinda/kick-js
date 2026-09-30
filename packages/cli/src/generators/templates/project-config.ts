type ProjectTemplate = 'rest' | 'minimal'

// `SchemaLib` is defined next to `resolveSchemaLib` in ../../config, so the
// scaffold that installs the library and the generators that import from it
// read the same list. Re-exported here for existing importers.
export type { SchemaLib } from '../../config'
import type { SchemaLib } from '../../config'

/** Map of optional package names to their npm package identifiers */
const PACKAGE_DEPS: Record<string, string> = {
  swagger: '@forinda/kickjs-swagger',
  ws: '@forinda/kickjs-ws',
  queue: '@forinda/kickjs-queue',
  devtools: '@forinda/kickjs-devtools',
}

/**
 * Schema-lib runtime dependency ranges. Pinned to a recent release.
 *
 * Exactly one of these is installed, chosen by `--schema`; `zod` is the `--yes`
 * default for its ecosystem reach (OpenAPI generation, the Standard Schema
 * brand `kick typegen` reads). Whichever lands here is what `resolveSchemaLib`
 * later detects when generating DTO schemas.
 */
const SCHEMA_LIB_NAMES: Record<SchemaLib, string> = {
  zod: 'zod',
  valibot: 'valibot',
  yup: 'yup',
}

/**
 * Map of package name → semver range string (`^x.y.z`). Resolved
 * from `npm view <name> version` upstream so per-package independent
 * versioning is honoured at scaffold time. Every sibling
 * `@forinda/kickjs-*` package we might add to the new project must
 * appear here; missing keys throw during package.json generation
 * (loud failure beats silently shipping `^undefined`).
 */
export type SiblingVersions = Record<string, string>

function take(versions: SiblingVersions, name: string): string {
  const v = versions[name]
  if (!v) {
    throw new Error(
      `generatePackageJson: missing resolved version for ${name}. ` +
        `Add it to SIBLING_PACKAGES in generators/project.ts.`,
    )
  }
  return v
}

/** Generate package.json with template-aware dependencies */
export function generatePackageJson(
  name: string,
  template: ProjectTemplate,
  versions: SiblingVersions,
  packages: string[] = [],
  schemaLib: SchemaLib = 'zod',
  runtime: 'express' | 'fastify' | 'h3' = 'express',
  /**
   * Pin the TypeScript 7 compiler API, needed to resolve the client route map
   * (`.kickjs/types/kick__client.d.ts`). Set by the fullstack generator, whose
   * web app reads that map from the ambient `KickClientApi` namespace.
   *
   * Deliberately a flag rather than `template === 'fullstack'`: the fullstack
   * workspace scaffolds its SERVER with `template: 'minimal'`, so keying off
   * the template name silently pinned nothing.
   */
  withClientMap = false,
): string {
  const schemaLibName = SCHEMA_LIB_NAMES[schemaLib]
  const baseDeps: Record<string, string> = {
    '@forinda/kickjs': take(versions, '@forinda/kickjs'),
    // The schema-agnostic abstraction kickjs-schema wraps zod / valibot
    // / yup behind a single `KickSchema` interface — env validation,
    // body validation, and swagger spec generation all flow through
    // `detectSchema()`. Shipping it as a direct dep (rather than a peer)
    // keeps the new-project install one-step.
    '@forinda/kickjs-schema': take(versions, '@forinda/kickjs-schema'),
    // `dotenv` is an optional peer of @forinda/kickjs — scaffolded apps
    // get it pre-installed so `.env` files Just Work. Apps that load
    // env from the shell or a secret manager can drop this safely.
    dotenv: take(versions, 'dotenv'),
    'reflect-metadata': take(versions, 'reflect-metadata'),
    [schemaLibName]: take(versions, schemaLibName),
  }

  // Engine peers for the chosen runtime (optional peers of @forinda/kickjs).
  if (runtime === 'express') {
    // Express is the engine itself.
    baseDeps.express = take(versions, 'express')
  } else if (runtime === 'fastify') {
    baseDeps.fastify = take(versions, 'fastify')
    baseDeps['@fastify/middie'] = take(versions, '@fastify/middie')
    // Static serving uses `serve-static` (no express dependency).
    baseDeps['serve-static'] = take(versions, 'serve-static')
  } else if (runtime === 'h3') {
    baseDeps.h3 = take(versions, 'h3')
    baseDeps['serve-static'] = take(versions, 'serve-static')
  }

  // Add user-selected optional packages — each looked up against
  // the resolved version map so they're independently up-to-date.
  for (const pkg of packages) {
    const dep = PACKAGE_DEPS[pkg]
    if (dep && !baseDeps[dep]) {
      baseDeps[dep] = take(versions, dep)
    }
  }

  return JSON.stringify(
    {
      name,
      // Project starts at 0.0.0 — adopters bump as they ship. Tying
      // the project version to the CLI version (the previous
      // behaviour) made every scaffolded app `5.4.0` on day one,
      // which broke npm publishing for adopters trying their first
      // release.
      version: '0.0.0',
      type: 'module',
      scripts: {
        // `kick dev` (not bare `vite`): it boots Vite itself AND owns the
        // typegen-on-save watcher. Plain `vite` gives working HMR but
        // frozen `.kickjs/types` — new routes silently lose their typing
        // until a manual `kick typegen`.
        // Four scripts, not ten. Everything dropped from here is still one
        // command away — `kick dev:debug`, `kick typegen`, `pnpm exec vitest`,
        // `pnpm exec tsc --noEmit` — and a scaffold that opens with a wall of
        // aliases teaches less than one that shows the binary.
        //
        // `lint: 'eslint src/'` used to be here without eslint ever being a
        // dependency, so `lint` failed with "command not found" in every
        // generated project.
        dev: 'kick dev',
        build: 'kick build',
        start: 'kick start',
        test: 'vitest run',
        // Serverless targets — see guide/serverless.md. Each bundles
        // src/serverless.ts and writes the platform's build output.
        'build:netlify': 'kick build && kick build:netlify',
        'build:vercel': 'kick build && kick build:vercel',
      },
      dependencies: baseDeps,
      devDependencies: {
        '@forinda/kickjs-cli': take(versions, '@forinda/kickjs-cli'),
        // The generated AGENTS.md and the `write-controller-test` skill both
        // tell you to test with `createTestApp` + supertest. Shipping those
        // instructions without the packages means the first test a reader
        // writes fails on a missing import.
        '@forinda/kickjs-testing': take(versions, '@forinda/kickjs-testing'),
        '@forinda/kickjs-vite': take(versions, '@forinda/kickjs-vite'),
        '@types/supertest': take(versions, '@types/supertest'),
        '@swc/core': take(versions, '@swc/core'),
        // Express types only when Express is the engine (it's the only runtime
        // that imports `express` in src/index.ts).
        ...(runtime === 'express' ? { '@types/express': take(versions, '@types/express') } : {}),
        '@types/node': take(versions, '@types/node'),
        'unplugin-swc': take(versions, 'unplugin-swc'),
        vite: take(versions, 'vite'),
        supertest: take(versions, 'supertest'),
        vitest: take(versions, 'vitest'),
        typescript: take(versions, 'typescript'),
        // Only scaffolds that consume the client route map pin the TypeScript 7
        // compiler API: it is a 10 kB shim over a 24 MB `typescript@6`, which is
        // not something to put in every project. Today that means fullstack,
        // whose web app reads the map from the ambient `KickClientApi`
        // namespace. rest/minimal have no frontend and stay lean.
        ...(withClientMap
          ? { '@typescript/typescript6': take(versions, '@typescript/typescript6') }
          : {}),
        oxfmt: take(versions, 'oxfmt'),
        oxlint: take(versions, 'oxlint'),
      },
    },
    null,
    2,
  )
}

/**
 * Generate vite.config.ts with the KickJS Vite plugin.
 *
 * The plugin handles:
 * - SSR environment setup for backend Node.js code
 * - Virtual module generation (virtual:kickjs/app)
 * - Module auto-discovery (scans *.module.ts files)
 * - HMR with selective container invalidation
 * - Express mounting via configureServer() post-hook
 * - httpServer piping to adapters (WsAdapter, Socket.IO, etc.)
 */
export function generateViteConfig(options: { strictPort?: boolean } = {}): string {
  // The fullstack web app proxies /api to a fixed port. Without strictPort,
  // Vite moves to the next free port when that one is taken and the proxy
  // silently talks to whatever else holds it; with it, `kick dev` fails loudly.
  const server = options.strictPort
    ? `  server: {
    // web/vite.config.ts proxies /api to this port — fail instead of moving
    // to another port when it's taken, or the proxy would reach the wrong process.
    strictPort: true,
  },
`
    : ''
  return `import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    // Watches .env files and triggers a full reload on change so the
    // dev server picks up env tweaks without a manual restart.
    envWatchPlugin(),
  ],
${server}  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'node20',
    ssr: true,
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      output: { format: 'esm' },
    },
  },
})
`
}

/**
 * `netlify.toml` for `kick build:netlify`.
 *
 * Netlify publishes a directory whatever else happens: with a frontend that
 * is its build, and without one it must be an empty directory the build
 * creates — otherwise Netlify serves the project's own files as static
 * content, and those shadow the function.
 */
export function generateNetlifyToml(options: {
  command: string
  publish: string
  spa: boolean
}): string {
  const redirect = options.spa
    ? `
# Client-side routes fall back to the app shell. The function claims /api/*
# through its own \`config.path\`, so this rule never sees those requests.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`
    : ''
  return `[build]
  command = "${options.command}"
  publish = "${options.publish}"

[build.environment]
  NODE_VERSION = "22"
${redirect}`
}

/**
 * `vercel.json` for a Git-connected project. `framework: null` keeps Vercel
 * from treating the repo as a plain Vite app; the build writes
 * `.vercel/output`, which Vercel then deploys as-is.
 */
export function generateVercelJson(buildCommand: string): string {
  return `${JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      buildCommand,
    },
    null,
    2,
  )}\n`
}

/**
 * Answer pnpm's build-script approvals for `builds` in pnpm-workspace.yaml text,
 * in both formats pnpm has used, so any pnpm 10+ reads them:
 *
 * - `allowBuilds` (pnpm 10.26+; pnpm 11 reads only this)
 * - `onlyBuiltDependencies` / `ignoredBuiltDependencies` (pnpm before 10.26)
 *
 * Each version ignores the format it doesn't read. An existing answer wins: an
 * `allowBuilds` key set to true/false, or a name already in either list, is left
 * alone. A missing key or pnpm's `set this to true or false` placeholder is filled in.
 */
export function setAllowBuilds(yaml: string, builds: Record<string, boolean>): string {
  const entries = Object.entries(builds)
  if (entries.length === 0) return yaml
  const lines = yaml === '' ? [] : yaml.replace(/\n$/, '').split('\n')
  const unquote = (text: string) => text.trim().replace(/^['"]|['"]$/g, '')
  const quote = (name: string) => (/^[\w-]+$/.test(name) ? name : `'${name}'`)

  /** Line range of a top-level block's indented entries; appended when missing and `create`. */
  const block = (key: string, create: boolean): { start: number; end: number } | undefined => {
    let start = lines.findIndex((line) => line.replace(/\s+$/, '') === `${key}:`)
    if (start === -1) {
      if (!create) return undefined
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      lines.push(`${key}:`)
      start = lines.length - 1
    }
    // The block runs to the next unindented line; blank lines inside it don't end it.
    let end = start + 1
    for (let i = start + 1; i < lines.length && /^(\s|$)/.test(lines[i]); i++) {
      if (lines[i].trim() !== '') end = i + 1
    }
    return { start, end }
  }

  const answers: Array<[string, boolean]> = []
  for (const [name, allow] of entries) {
    const { start, end } = block('allowBuilds', true)!
    const index = lines
      .slice(start + 1, end)
      .findIndex((line) => unquote(line.split(':')[0]) === name)
    const answered =
      index === -1 ? undefined : /:\s*(true|false)\s*$/.exec(lines[start + 1 + index])
    if (answered) {
      answers.push([name, answered[1] === 'true'])
      continue
    }
    const entry = `  ${quote(name)}: ${allow}`
    if (index === -1) lines.splice(end, 0, entry)
    else lines[start + 1 + index] = entry
    answers.push([name, allow])
  }

  const lists = ['onlyBuiltDependencies', 'ignoredBuiltDependencies']
  for (const [name, allow] of answers) {
    const listed = lists.some((key) => {
      const range = block(key, false)
      return (
        range !== undefined &&
        lines
          .slice(range.start + 1, range.end)
          .some((line) => unquote(line.replace(/^\s*-/, '')) === name)
      )
    })
    if (listed) continue
    const { end } = block(allow ? lists[0] : lists[1], true)!
    lines.splice(end, 0, `  - ${quote(name)}`)
  }
  return `${lines.join('\n')}\n`
}
