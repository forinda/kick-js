// `kick new --template fullstack` — a pnpm-workspace monorepo:
//
//   my-app/
//     server/   KickJS API (the standard scaffold, minus its own git/install)
//     web/      Vite + React frontend typed end-to-end via
//               @forinda/kickjs-client + the server's generated KickRoutes.Api
//
// The type loop: server controllers use return-value handlers → `kick
// typegen` (run here once, re-run by `kick dev`) emits
// server/.kickjs/types/kick__routes.ts → web/src/types/kick-routes.d.ts
// side-effect-imports that file (type-only, erased at runtime) → the web
// client calls `api.get('/hello')` with the handler's actual response type.

import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { writeFileSafe } from '../utils/fs'
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
    // Root owns install + git so the lockfile/commit cover the workspace.
    initGit: false,
    installDeps: false,
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
  await writeFileSafe(join(dir, 'web/src/types/kick-routes.d.ts'), webRouteTypes())

  // ── workspace root ──────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'package.json'), rootPackageJson(name, packageManager))
  await writeFileSafe(join(dir, 'pnpm-workspace.yaml'), `packages:\n  - server\n  - web\n`)
  await writeFileSafe(join(dir, '.gitignore'), rootGitignore())
  await writeFileSafe(join(dir, 'README.md'), rootReadme(name, packageManager))

  // ── install (root — covers both workspace packages) ────────────────
  if (options.installDeps) {
    console.log(`\n  Installing workspace dependencies with ${packageManager}...\n`)
    try {
      execFileSync(packageManager, ['install'], { cwd: dir, stdio: 'inherit' })
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

function webTsConfig(): string {
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
        // The type bridge pulls server controller sources into this
        // program — they use legacy TS decorators.
        experimentalDecorators: true,
        // The KickRoutes ambient types come from the server's generated
        // typegen output via src/types/kick-routes.d.ts.
        types: [],
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
// change server/src/modules/hello/hello.service.ts and these types follow
// on the next \`kick typegen\` (automatic under \`kick dev\`).
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

function webApi(): string {
  return `import { createClient } from '@forinda/kickjs-client'

// KickRoutes.Api is ambient — populated by server/.kickjs/types (see
// src/types/kick-routes.d.ts). Keys are module-mount-relative paths;
// the bootstrap-level '/api/v1' prefix lives here in baseUrl, and the
// Vite dev proxy forwards it to the KickJS server.
export const api = createClient<KickRoutes.Api>({ baseUrl: '/api/v1' })
`
}

function webRouteTypes(): string {
  return `// Type-only bridge to the server's generated route types. The import is
// erased at build time — no server code ever enters the web bundle.
// Regenerate with \`kick typegen\` in server/ (automatic under \`kick dev\`).
import '../../../server/.kickjs/types/kick__routes'
`
}

// ── root templates ────────────────────────────────────────────────────

function rootPackageJson(name: string, pm: string): string {
  const scripts: Record<string, string> =
    pm === 'pnpm'
      ? {
          dev: 'pnpm --parallel -r run dev',
          'dev:server': 'pnpm --filter ./server dev',
          'dev:web': 'pnpm --filter ./web dev',
          build: 'pnpm -r run build',
          typecheck: 'pnpm -r run typecheck',
        }
      : {
          // cd-based scripts — the one form npm, yarn (classic AND berry),
          // and bun all run identically; workspace-filter flags differ per
          // manager (--workspace vs `yarn workspace <name>` vs --filter).
          'dev:server': `cd server && ${pm} run dev`,
          'dev:web': `cd web && ${pm} run dev`,
          build: `${pm} run build:server && ${pm} run build:web`,
          'build:server': `cd server && ${pm} run build`,
          'build:web': `cd web && ${pm} run build`,
          typecheck: `cd web && ${pm} run typecheck`,
        }
  return `${JSON.stringify(
    {
      name,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts,
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
2. \`kick typegen\` (auto under \`kick dev\`) emits \`server/.kickjs/types/kick__routes.ts\` —
   including the flat \`KickRoutes.Api\` map with inferred response types.
3. \`web/src/types/kick-routes.d.ts\` imports that file type-only.
4. \`web/src/api.ts\`'s \`createClient<KickRoutes.Api>\` types every call site.

Rename a field in \`server/src/modules/hello/hello.service.ts\` → \`web/src/App.tsx\`
stops compiling. That's the point.

Docs: https://kickjs.app/guide/typed-client.html
`
}
