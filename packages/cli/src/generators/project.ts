import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeFileSafe } from '../utils/fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliPkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
const KICKJS_VERSION = `^${cliPkg.version}`

type ProjectTemplate = 'rest' | 'graphql' | 'ddd' | 'microservice' | 'minimal'

interface InitProjectOptions {
  name: string
  directory: string
  packageManager?: 'pnpm' | 'npm' | 'yarn'
  initGit?: boolean
  installDeps?: boolean
  template?: ProjectTemplate
}

/** Scaffold a new KickJS project */
export async function initProject(options: InitProjectOptions): Promise<void> {
  const { name, directory, packageManager = 'pnpm', template = 'rest' } = options
  const dir = directory

  console.log(`\n  Creating KickJS project: ${name}\n`)

  // ── package.json — template-aware deps ────────────────────────────
  const baseDeps: Record<string, string> = {
    '@forinda/kickjs-core': KICKJS_VERSION,
    '@forinda/kickjs-http': KICKJS_VERSION,
    '@forinda/kickjs-config': KICKJS_VERSION,
    express: '^5.1.0',
    'reflect-metadata': '^0.2.2',
    zod: '^4.3.6',
    pino: '^10.3.1',
    'pino-pretty': '^13.1.3',
  }

  // Add template-specific deps
  if (template !== 'minimal') {
    baseDeps['@forinda/kickjs-swagger'] = KICKJS_VERSION
  }
  if (template === 'graphql') {
    baseDeps['@forinda/kickjs-graphql'] = KICKJS_VERSION
    baseDeps['graphql'] = '^16.11.0'
  }
  if (template === 'microservice') {
    baseDeps['@forinda/kickjs-queue'] = KICKJS_VERSION
    baseDeps['@forinda/kickjs-otel'] = KICKJS_VERSION
  }
  if (template === 'ddd') {
    baseDeps['@forinda/kickjs-swagger'] = KICKJS_VERSION
  }

  await writeFileSafe(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        version: cliPkg.version,
        type: 'module',
        scripts: {
          dev: 'kick dev',
          'dev:debug': 'kick dev:debug',
          build: 'kick build',
          start: 'kick start',
          test: 'vitest run',
          'test:watch': 'vitest',
          typecheck: 'tsc --noEmit',
          lint: 'eslint src/',
          format: 'prettier --write src/',
        },
        dependencies: baseDeps,
        devDependencies: {
          '@forinda/kickjs-cli': KICKJS_VERSION,
          '@swc/core': '^1.7.28',
          '@types/express': '^5.0.6',
          '@types/node': '^24.5.2',
          'unplugin-swc': '^1.5.9',
          vite: '^7.3.1',
          'vite-node': '^5.3.0',
          vitest: '^3.2.4',
          typescript: '^5.9.2',
          prettier: '^3.8.1',
        },
      },
      null,
      2,
    ),
  )

  // ── vite.config.ts — enables HMR + SWC for decorators ──────────────
  await writeFileSafe(
    join(dir, 'vite.config.ts'),
    `import { defineConfig } from 'vite'
import { resolve } from 'path'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    watch: { usePolling: false },
    hmr: true,
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
`,
  )

  // ── tsconfig.json ───────────────────────────────────────────────────
  await writeFileSafe(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2022'],
          types: ['node'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          sourceMap: true,
          declaration: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          outDir: 'dist',
          rootDir: 'src',
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      },
      null,
      2,
    ),
  )

  // ── .prettierrc ─────────────────────────────────────────────────────
  await writeFileSafe(
    join(dir, '.prettierrc'),
    JSON.stringify(
      {
        semi: false,
        singleQuote: true,
        trailingComma: 'all',
        printWidth: 100,
        tabWidth: 2,
      },
      null,
      2,
    ),
  )

  // ── .gitignore ──────────────────────────────────────────────────────
  await writeFileSafe(
    join(dir, '.gitignore'),
    `node_modules/
dist/
.env
coverage/
.DS_Store
*.tsbuildinfo
`,
  )

  // ── .env ────────────────────────────────────────────────────────────
  await writeFileSafe(
    join(dir, '.env'),
    `PORT=3000
NODE_ENV=development
`,
  )

  await writeFileSafe(
    join(dir, '.env.example'),
    `PORT=3000
NODE_ENV=development
`,
  )

  // ── src/index.ts — template-aware entry point ─────────────────────
  await writeFileSafe(join(dir, 'src/index.ts'), getEntryFile(name, template))

  // ── src/modules/index.ts ────────────────────────────────────────────
  await writeFileSafe(
    join(dir, 'src/modules/index.ts'),
    `import type { AppModuleClass } from '@forinda/kickjs-core'

export const modules: AppModuleClass[] = []
`,
  )

  // ── Template-specific files ─────────────────────────────────────────
  if (template === 'graphql') {
    await writeFileSafe(join(dir, 'src/resolvers/.gitkeep'), '')
  }

  // ── kick.config.ts — CLI configuration ─────────────────────────────
  await writeFileSafe(
    join(dir, 'kick.config.ts'),
    `import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: '${template}',
  modulesDir: 'src/modules',
  defaultRepo: 'inmemory',

  commands: [
    {
      name: 'test',
      description: 'Run tests with Vitest',
      steps: 'npx vitest run',
    },
    {
      name: 'format',
      description: 'Format code with Prettier',
      steps: 'npx prettier --write src/',
    },
    {
      name: 'format:check',
      description: 'Check formatting without writing',
      steps: 'npx prettier --check src/',
    },
    {
      name: 'check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify', 'ci'],
    },
  ],
})
`,
  )

  // ── vitest.config.ts ────────────────────────────────────────────────
  await writeFileSafe(
    join(dir, 'vitest.config.ts'),
    `import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
`,
  )

  // ── Git Init ─────────────────────────────────────────────────────────
  if (options.initGit) {
    try {
      execSync('git init', { cwd: dir, stdio: 'pipe' })
      execSync('git add -A', { cwd: dir, stdio: 'pipe' })
      execSync('git commit -m "chore: initial commit from kick new"', {
        cwd: dir,
        stdio: 'pipe',
      })
      console.log('  Git repository initialized')
    } catch {
      console.log('  Warning: git init failed (git may not be installed)')
    }
  }

  // ── Install Dependencies ────────────────────────────────────────────
  if (options.installDeps) {
    console.log(`\n  Installing dependencies with ${packageManager}...\n`)
    try {
      execSync(`${packageManager} install`, { cwd: dir, stdio: 'inherit' })
      console.log('\n  Dependencies installed successfully!')
    } catch {
      console.log(`\n  Warning: ${packageManager} install failed. Run it manually.`)
    }
  }

  console.log('\n  Project scaffolded successfully!')
  console.log()

  const needsCd = dir !== process.cwd()
  console.log('  Next steps:')
  if (needsCd) console.log(`    cd ${name}`)
  if (!options.installDeps) console.log(`    ${packageManager} install`)

  const genHint: Record<string, string> = {
    rest: 'kick g module user',
    graphql: 'kick g resolver user',
    ddd: 'kick g module user --repo drizzle',
    microservice: 'kick g module user && kick g job email',
    minimal: '# add your routes to src/index.ts',
  }
  console.log(`    ${genHint[template] ?? genHint.rest}`)
  console.log('    kick dev')
  console.log()
  console.log('  Commands:')
  console.log('    kick dev         Start dev server with Vite HMR')
  console.log('    kick build       Production build via Vite')
  console.log('    kick start       Run production build')
  console.log(`    kick g module X  Generate a DDD module`)
  if (template === 'graphql') console.log('    kick g resolver X  Generate a GraphQL resolver')
  if (template === 'microservice')
    console.log('    kick g job X       Generate a queue job processor')
  console.log()
}

// ── Entry file templates ─────────────────────────────────────────────────

function getEntryFile(name: string, template: ProjectTemplate): string {
  switch (template) {
    case 'graphql':
      return `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
import { GraphQLAdapter } from '@forinda/kickjs-graphql'
import { modules } from './modules'

// Import your resolvers here
// import { UserResolver } from './resolvers/user.resolver'

bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    new GraphQLAdapter({
      resolvers: [/* UserResolver */],
      // Add custom type definitions here:
      // typeDefs: userTypeDefs,
    }),
  ],
})
`

    case 'microservice':
      return `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { OtelAdapter } from '@forinda/kickjs-otel'
// import { QueueAdapter, BullMQProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new OtelAdapter({ serviceName: '${name}' }),
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: '${name}', version: '${cliPkg.version}' },
    }),
    // Uncomment when Redis is available:
    // new QueueAdapter({
    //   provider: new BullMQProvider({ host: 'localhost', port: 6379 }),
    // }),
  ],
})
`

    case 'minimal':
      return `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { modules } from './modules'

bootstrap({ modules })
`

    case 'ddd':
    case 'rest':
    default:
      return `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: '${name}', version: '${cliPkg.version}' },
    }),
  ],
})
`
  }
}
