// `kick new --template fullstack` — a pnpm-workspace monorepo:
//
//   my-app/
//     server/   KickJS API (the standard scaffold, minus its own git/install)
//     web/      Vite + React frontend typed end-to-end via
//               @forinda/kickjs-client + the server's generated KickRoutes.Api
//
// The type loop: server controllers use return-value handlers → `kick
// typegen` (run here once, re-run by `kick dev`) emits
// server/.kickjs/types/kick__client.d.ts → web tsconfig `types` (ambient)
// side-effect-imports that file (type-only, erased at runtime) → the web
// client calls `api.get('/hello')` with the handler's actual response type.

import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { writeFileSafe } from '../utils/fs'
import { runCommand } from '../utils/shell'
import { initProject, resolveSiblingVersions } from './project'

export interface InitFullstackOptions {
  name: string
  directory: string
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun'
  initGit?: boolean
  installDeps?: boolean
  schemaLib?: 'zod' | 'valibot' | 'yup'
  runtime?: 'express' | 'fastify' | 'h3'
}

export async function initFullstackProject(options: InitFullstackOptions): Promise<void> {
  const { name, directory, schemaLib = 'zod', runtime = 'express' } = options
  // `--pm` arrives as a free CLI string — allowlist before it reaches a
  // process invocation (execFileSync takes an argv array, no shell, but a
  // bogus binary name is still a confusing failure).
  const pmValid = (['pnpm', 'npm', 'yarn', 'bun'] as const).includes(
    options.packageManager as never,
  )
  const packageManager = pmValid
    ? (options.packageManager as 'pnpm' | 'npm' | 'yarn' | 'bun')
    : 'pnpm'
  const dir = directory
  const log = (msg: string) => console.log(`  ${msg}`)
  if (options.packageManager !== undefined && !pmValid) {
    log(
      `Warning: unknown package manager '${String(options.packageManager)}' — falling back to pnpm.`,
    )
  }

  console.log(`\n  Creating fullstack KickJS workspace: ${name}\n`)

  // ── server/ — the standard scaffold, deferred install/git ──────────
  await initProject({
    name: `${name}-server`,
    directory: join(dir, 'server'),
    packageManager,
    template: 'minimal',
    schemaLib,
    runtime,
    // web/ reads the resolved route map from the ambient KickClientApi
    // namespace, which needs the TS 7 compiler API to produce.
    withClientMap: true,
    // Root owns install + git so the lockfile/commit cover the workspace.
    initGit: false,
    installDeps: false,
    // Production single-origin serving. `web/` builds to `web/dist`, and
    // nothing served it before — `pnpm build` produced a frontend the API had
    // no way to hand out, so every deploy needed a hand-wired static host or
    // a second process. The adapter is inert until `../web/dist` exists, so
    // `dev` (Vite serves the client and proxies /api here) is untouched.
    spaClientDir: '../web/dist',
  })

  // ── web/ — Vite + React, typed client ──────────────────────────────
  const versions = await resolveSiblingVersions()
  const clientVersion = versions['@forinda/kickjs-client'] ?? '^0.1.0'

  await writeFileSafe(join(dir, 'web/package.json'), webPackageJson(name, clientVersion))
  await writeFileSafe(join(dir, 'web/vite.config.ts'), webViteConfig())
  await writeFileSafe(join(dir, 'web/tsconfig.json'), webTsConfig())
  await writeFileSafe(join(dir, 'web/index.html'), webIndexHtml(name))
  await writeFileSafe(join(dir, 'web/src/main.tsx'), webMain())
  await writeFileSafe(join(dir, 'web/src/App.tsx'), webApp())
  await writeFileSafe(join(dir, 'web/src/api.ts'), webApi())

  // ── workspace root ──────────────────────────────────────────────────
  await writeFileSafe(
    join(dir, 'package.json'),
    rootPackageJson(name, packageManager, versions['@forinda/kickjs-cli']),
  )
  // Only pnpm reads this file. npm / yarn / bun declare workspaces via the
  // `workspaces` field in the root package.json instead — see rootPackageJson.
  if (packageManager === 'pnpm') {
    // `allowBuilds` is answered here, not left to pnpm. This scaffold installs
    // non-interactively, so pnpm cannot prompt — it writes
    // `'@swc/core': set this to true or false` and then refuses to run ANY
    // script with ERR_PNPM_IGNORED_BUILDS, leaving a fresh project unable to
    // run `pnpm typecheck` or `pnpm dev` until someone edits this file.
    //
    // Both are build tools this template chose: swc compiles the decorators,
    // esbuild is Vite's. Approving their install scripts is the same decision
    // as depending on them.
    await writeFileSafe(
      join(dir, 'pnpm-workspace.yaml'),
      `packages:\n  - server\n  - web\n\nallowBuilds:\n  '@swc/core': true\n  esbuild: true\n`,
    )
  }
  await writeFileSafe(join(dir, '.gitignore'), rootGitignore())
  await writeFileSafe(join(dir, 'README.md'), rootReadme(name, packageManager))

  // Workspace-root agent docs (CLAUDE.md + .agents/) flavored for the
  // fullstack layout — the server/ subdir keeps its own generated set.
  const { generateAgentDocs } = await import('./agent-docs')
  await generateAgentDocs({
    outDir: dir,
    name,
    pm: packageManager,
    template: 'fullstack',
    only: 'all',
    force: true,
  })

  // ── install (root — covers both workspace packages) ────────────────
  if (options.installDeps) {
    console.log(`\n  Installing workspace dependencies with ${packageManager}...\n`)
    try {
      // `runCommand`, not bare execFileSync — on Windows every package
      // manager is a `.cmd` shim that execFileSync cannot spawn.
      runCommand(packageManager, ['install'], { cwd: dir })
    } catch {
      console.log(`\n  Warning: ${packageManager} install failed. Run it manually.`)
    }
  }

  // ── typegen (server) so web's KickRoutes.Api resolves immediately ──
  try {
    const { runTypegen } = await import('../typegen')
    await runTypegen({ cwd: join(dir, 'server'), allowDuplicates: true, silent: true })
  } catch {
    // Non-fatal — `kick dev` in server/ retries on boot.
  }

  // ── git (root) ──────────────────────────────────────────────────────
  if (options.initGit) {
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
      execFileSync('git', ['branch', '-M', 'main'], { cwd: dir, stdio: 'pipe' })
      execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
      execFileSync('git', ['commit', '-m', 'chore: initial commit from kick new (fullstack)'], {
        cwd: dir,
        stdio: 'pipe',
      })
      log('Git repository initialized')
    } catch {
      log('Warning: git init failed (git may not be installed)')
    }
  }

  console.log('\n  Fullstack workspace scaffolded!')
  console.log()
  log('Next steps:')
  log(`  cd ${name}`)
  if (!options.installDeps) log(`  ${packageManager} install`)
  if (packageManager === 'pnpm') {
    log('  pnpm dev            # runs server (kick dev) + web (vite) together')
  } else {
    log(`  ${packageManager} run dev:server   # terminal 1`)
    log(`  ${packageManager} run dev:web      # terminal 2`)
  }
  log('')
  log('The web app calls the API through @forinda/kickjs-client —')
  log("edit server/src/modules/hello and watch web/src/App.tsx's types follow.")
  log('')
}

// ── web templates ─────────────────────────────────────────────────────

function webPackageJson(name: string, clientVersion: string): string {
  return `${JSON.stringify(
    {
      name: `${name}-web`,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc --noEmit && vite build',
        preview: 'vite preview',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        '@forinda/kickjs-client': clientVersion,
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^5.0.0',
        typescript: '^5.9.0',
        vite: '^7.0.0',
      },
    },
    null,
    2,
  )}\n`
}

function webViteConfig(): string {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // The KickJS server (kick dev) listens on 3000; the client's baseUrl is
    // the relative '/api/v1', so the browser hits Vite and Vite forwards.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
`
}

export function webTsConfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        isolatedModules: true,
        // The resolved client route map, as an ambient global type package —
        // the same mechanism as "node" or "vitest/globals". It makes
        // `KickClientApi.Api` available with no import and no bridge file.
        //
        // Note this is a `types` ENTRY, not an `include`: the map is a global
        // type package, not source of this app. It also means the file must
        // exist — `kick new` runs typegen for you, and `kick typegen` in
        // server/ refreshes it. (An `include` entry tolerates the file being
        // absent; a `types` entry reports TS2688, which is the louder and
        // more useful failure for something the app depends on.)
        //
        // No `experimentalDecorators` here: unlike the ambient
        // `KickRoutes.Api` bridge, this map carries no reference to the
        // server's decorated controller sources.
        types: ['../server/.kickjs/types/kick__client'],
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`
}

function webIndexHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

function webMain(): string {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`
}

function webApp(): string {
  return `import { useEffect, useState } from 'react'
import { api } from './api'

// The response types below are INFERRED from the server's handlers —
// change server/src/modules/hello/hello.service.ts and these types follow on
// the next \`kick typegen\`. Not under \`kick dev\`: resolving the client map
// builds a whole TypeScript program, so it is a build step, not a per-save one.
type Greeting = Awaited<ReturnType<typeof fetchGreeting>>

function fetchGreeting() {
  return api.get('/hello')
}

export function App() {
  const [greeting, setGreeting] = useState<Greeting | null>(null)
  const [health, setHealth] = useState<string>('checking…')

  useEffect(() => {
    fetchGreeting().then(setGreeting).catch(console.error)
    api
      .get('/hello/health')
      .then((h) => setHealth(h.status))
      .catch(() => setHealth('down'))
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>KickJS fullstack</h1>
      <p>
        <strong>{greeting?.message ?? 'loading…'}</strong>
      </p>
      <p>
        Server said hello at <code>{greeting?.timestamp ?? '…'}</code> — health:{' '}
        <code>{health}</code>
      </p>
      <p style={{ color: '#666' }}>
        This call is typed end to end: <code>api.get('/hello')</code> returns the exact shape
        <code> HelloService.greet()</code> produces. Rename a field on the server and this file
        stops compiling.
      </p>
    </main>
  )
}
`
}

export function webApi(): string {
  return `import { createClient } from '@forinda/kickjs-client'

// KickClientApi is ambient — the resolved route map from
// server/.kickjs/types/kick__client.d.ts, wired in tsconfig's \`types\`. Every
// response type is a literal shape, so nothing from the server's source graph
// enters this program.
//
// Keys are module-mount-relative paths; the bootstrap-level '/api/v1' prefix
// lives here in baseUrl, and the Vite dev proxy forwards it to the KickJS
// server.
//
// Prefer an explicit import? The same file exports the type:
//   import type { Api } from '../../server/.kickjs/types/kick__client'
export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
`
}

// ── root templates ────────────────────────────────────────────────────

function rootPackageJson(name: string, pm: string, cliVersion: string): string {
  const scripts: Record<string, string> =
    pm === 'pnpm'
      ? {
          dev: 'pnpm --parallel -r run dev',
          // One origin: the server serves `web/dist` through SpaAdapter.
          start: 'pnpm --filter ./server run start',
          'dev:server': 'pnpm --filter ./server dev',
          'dev:web': 'pnpm --filter ./web dev',
          build: 'pnpm -r run build',
          // No `npx`: the binary is `kick` but the package is
          // `@forinda/kickjs-cli`, so npx cannot map one to the other and
          // falls back to the REGISTRY — where `kick` is an unrelated
          // AngularJS scaffolder. It runs, prints its own help, and exits 0,
          // so this script would pass without type-checking anything.
          //
          // Every package manager puts `node_modules/.bin` on PATH for
          // scripts, so the bare name resolves locally, and a missing install
          // fails loudly instead of fetching a stranger.
          typecheck: 'kick typecheck --cwd server && kick typecheck --cwd web',
        }
      : {
          // cd-based scripts — the one form npm, yarn (classic AND berry),
          // and bun all run identically; workspace-filter flags differ per
          // manager (--workspace vs `yarn workspace <name>` vs --filter).
          start: `cd server && ${pm} run start`,
          'dev:server': `cd server && ${pm} run dev`,
          'dev:web': `cd web && ${pm} run dev`,
          build: `${pm} run build:server && ${pm} run build:web`,
          'build:server': `cd server && ${pm} run build`,
          'build:web': `cd web && ${pm} run build`,
          // No `npx`: the binary is `kick` but the package is
          // `@forinda/kickjs-cli`, so npx cannot map one to the other and
          // falls back to the REGISTRY — where `kick` is an unrelated
          // AngularJS scaffolder. It runs, prints its own help, and exits 0,
          // so this script would pass without type-checking anything.
          //
          // Every package manager puts `node_modules/.bin` on PATH for
          // scripts, so the bare name resolves locally, and a missing install
          // fails loudly instead of fetching a stranger.
          typecheck: 'kick typecheck --cwd server && kick typecheck --cwd web',
        }
  return `${JSON.stringify(
    {
      name,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts,
      // The CLI is a ROOT dependency so the bare `kick` in the scripts above
      // resolves: package managers put `node_modules/.bin` on PATH for
      // scripts, and the CLI otherwise lives only in `server/node_modules`.
      devDependencies: { '@forinda/kickjs-cli': cliVersion },
      workspaces: ['server', 'web'],
    },
    null,
    2,
  )}\n`
}

function rootGitignore(): string {
  return `node_modules/
dist/
.env
*.log
.DS_Store
`
}

function rootReadme(name: string, pm: string): string {
  return `# ${name}

Fullstack KickJS workspace — typed end to end.

| Package   | What                                                              |
| --------- | ----------------------------------------------------------------- |
| \`server/\` | KickJS API (decorators, DI, \`kick dev\` with typegen watch)       |
| \`web/\`    | Vite + React, typed against the API via \`@forinda/kickjs-client\` |

## Develop

\`\`\`bash
${pm} install
${pm === 'pnpm' ? 'pnpm dev            # server (kick dev) + web (vite), in parallel' : `${pm} run dev:server   # terminal 1\n${pm} run dev:web      # terminal 2`}
\`\`\`

Server: http://localhost:3000 · Web: http://localhost:5173 (Vite proxies \`/api\`).

## The type loop

1. Server handlers **return** their payloads (\`return this.service.greet(...)\`).
2. \`kick typegen\` emits \`server/.kickjs/types/kick__client.d.ts\` — the flat
   route map with every response type resolved to a literal shape.
3. \`web/tsconfig.json\` lists that file in \`types\`, so \`KickClientApi\` is
   ambient — no import, no bridge file.
4. \`web/src/api.ts\`'s \`createClient<KickClientApi.Api>\` types every call site.

Because the map holds resolved types rather than references to controllers,
\`web\` never compiles server source: no \`experimentalDecorators\`, no path
aliases into \`server/src\`.

Rename a field in \`server/src/modules/hello/hello.service.ts\` → \`web/src/App.tsx\`
stops compiling. That's the point.

### Keeping the map fresh

\`server/.kickjs/types/kick__client.d.ts\` is generated, and \`web\` reads it as
an ambient type package. Two things follow.

**It is not refreshed by \`kick dev\`.** Resolving it builds a whole TypeScript
program over the server, which is a build-step cost rather than a per-save one,
so a renamed response field surfaces on the next \`kick typegen\` rather than on
save. Everything else in \`.kickjs/types\` still updates on save. Add
\`kick typegen --check\` to CI and a stale map fails the build.

**It needs a compiler API.** TypeScript 7 ships none, so \`server\` depends on
\`@typescript/typescript6\`. Remove it and typegen skips this one file, saying
so; \`web\` then reports \`TS2688\` because the file it lists in \`types\` is gone.

### The other way to wire it

A \`types\` entry says "this is a global type package", which is what the map is,
and it fails loudly when the file is missing. If you would rather it be quiet
when absent — say, a repo where the map is not always generated — use
\`include\` instead:

\`\`\`json
{ "include": ["src", "../server/.kickjs/types/kick__client.d.ts"] }
\`\`\`

That tolerates the file not existing, at the cost of \`KickClientApi\` silently
not resolving. Note \`types\` replaces TypeScript's automatic \`@types\`
inclusion, so if you add entries there, list the ones you rely on too
(\`"types": ["node", "../server/.kickjs/types/kick__client"]\`).

Or skip the global entirely — the same file exports the type:

\`\`\`ts
import type { Api } from '../../server/.kickjs/types/kick__client'

export const api = createClient<Api>({ baseUrl: '/api/v1' })
\`\`\`

Docs: https://kickjs.app/guide/typed-client.html
`
}
