type ProjectTemplate = 'rest' | 'minimal'

/**
 * Supported schema libraries — passed through to `fromZod` /
 * `fromValibot` / `fromYup` in the generated env file. `zod` is the
 * default for `--yes` because it has the deepest ecosystem
 * compatibility (OpenAPI generation, Standard Schema brand for
 * `kick typegen`).
 */
export type SchemaLib = 'zod' | 'valibot' | 'yup'

/** Map of optional package names to their npm package identifiers */
const PACKAGE_DEPS: Record<string, string> = {
  swagger: '@forinda/kickjs-swagger',
  ws: '@forinda/kickjs-ws',
  queue: '@forinda/kickjs-queue',
  devtools: '@forinda/kickjs-devtools',
}

/** Schema-lib runtime dependency ranges. Pinned to a recent release. */
const SCHEMA_LIB_DEPS: Record<SchemaLib, { name: string; range: string }> = {
  zod: { name: 'zod', range: '^4.3.6' },
  valibot: { name: 'valibot', range: '^1.4.1' },
  yup: { name: 'yup', range: '^1.7.1' },
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
): string {
  const schemaDep = SCHEMA_LIB_DEPS[schemaLib]
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
    dotenv: '^17.3.1',
    express: '^5.1.0',
    'reflect-metadata': '^0.2.2',
    [schemaDep.name]: schemaDep.range,
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
        dev: 'kick dev',
        'dev:debug': 'kick dev:debug',
        build: 'kick build',
        start: 'kick start',
        test: 'vitest run',
        'test:watch': 'vitest',
        typecheck: 'tsc --noEmit',
        typegen: 'kick typegen',
        lint: 'eslint src/',
        format: 'prettier --write src/',
      },
      dependencies: baseDeps,
      devDependencies: {
        '@forinda/kickjs-cli': take(versions, '@forinda/kickjs-cli'),
        '@forinda/kickjs-vite': take(versions, '@forinda/kickjs-vite'),
        '@swc/core': '^1.15.21',
        '@types/express': '^5.0.6',
        '@types/node': '^25.0.0',
        'unplugin-swc': '^1.5.9',
        vite: '^8.0.3',
        vitest: '^4.1.2',
        typescript: '^6.0.3',
        prettier: '^3.8.1',
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
export function generateViteConfig(): string {
  return `import { defineConfig } from 'vite'
import { resolve } from 'node:path'
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
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'node20',
    ssr: true,
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.ts'),
      output: { format: 'esm' },
    },
  },
})
`
}

/** Generate tsconfig.json with decorator support */
export function generateTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022'],
        types: ['node', 'vite/client'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        sourceMap: true,
        declaration: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        outDir: 'dist',
        // rootDir omitted so .kickjs/types/*.d.ts can sit outside src/
        paths: { '@/*': ['./src/*'] },
      },
      // .kickjs/types is generated by `kick typegen` and refreshed
      // automatically on `kick dev`. Including it here makes
      // `container.resolve()` and module discovery type-safe.
      // Both .d.ts and .ts are matched: registry/services/modules are
      // declarations, but routes.ts holds resolvable imports from your
      // controllers' Zod schemas (TS silently degrades inline `import('...')`
      // inside `.d.ts` files under `moduleResolution: 'bundler'`).
      include: ['src', '.kickjs/types/**/*.d.ts', '.kickjs/types/**/*.ts'],
    },
    null,
    2,
  )
}

/** Generate .prettierrc with project formatting rules */
export function generatePrettierConfig(): string {
  return JSON.stringify(
    {
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
      tabWidth: 2,
    },
    null,
    2,
  )
}

/** Generate .editorconfig for consistent editor settings */
export function generateEditorConfig(): string {
  return `# https://editorconfig.org
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
`
}

/** Generate .gitignore with common Node.js patterns */
export function generateGitIgnore(): string {
  return `node_modules/
dist/
.env
coverage/
.DS_Store
*.tsbuildinfo
.kickjs/
`
}

/** Generate .gitattributes for consistent line endings */
export function generateGitAttributes(): string {
  return `# Auto-detect text files and normalise line endings to LF
* text=auto eol=lf

# Explicitly mark generated / binary files
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.woff binary
*.woff2 binary
*.ttf binary
*.eot binary

# Lock files — treat as generated
pnpm-lock.yaml -diff linguist-generated
yarn.lock -diff linguist-generated
package-lock.json -diff linguist-generated
`
}

/** Generate .env file with default environment variables */
export function generateEnv(): string {
  return `PORT=3000
NODE_ENV=development
`
}

/** Generate .env.example file as a template */
export function generateEnvExample(): string {
  return `PORT=3000
NODE_ENV=development
`
}

/** Generate vitest.config.ts for test configuration */
export function generateVitestConfig(): string {
  return `import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
`
}
