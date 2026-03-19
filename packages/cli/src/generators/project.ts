import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'

interface InitProjectOptions {
  name: string
  directory: string
  packageManager?: 'pnpm' | 'npm' | 'yarn'
}

/** Scaffold a new KickJS project */
export async function initProject(options: InitProjectOptions): Promise<void> {
  const { name, directory, packageManager = 'pnpm' } = options
  const dir = directory

  console.log(`\n  Creating KickJS project: ${name}\n`)

  // ── package.json ────────────────────────────────────────────────────
  await writeFileSafe(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '0.1.0',
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
        dependencies: {
          '@kickjs/core': '^0.1.0',
          '@kickjs/http': '^0.1.0',
          '@kickjs/config': '^0.1.0',
          '@kickjs/swagger': '^0.1.0',
          express: '^5.1.0',
          'reflect-metadata': '^0.2.2',
          zod: '^4.3.6',
          pino: '^10.3.1',
          'pino-pretty': '^13.1.3',
        },
        devDependencies: {
          '@kickjs/cli': '^0.1.0',
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

  // ── src/index.ts — clean entry point with Swagger baked in ────────
  await writeFileSafe(
    join(dir, 'src/index.ts'),
    `import 'reflect-metadata'
import { bootstrap } from '@kickjs/http'
import { SwaggerAdapter } from '@kickjs/swagger'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new SwaggerAdapter({
      info: { title: '${name}', version: '0.1.0' },
    }),
  ],
})
`,
  )

  // ── src/modules/index.ts ────────────────────────────────────────────
  await writeFileSafe(
    join(dir, 'src/modules/index.ts'),
    `import type { AppModuleClass } from '@kickjs/core'

export const modules: AppModuleClass[] = []
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

  console.log('  Project scaffolded successfully!')
  console.log()
  console.log('  Next steps:')
  console.log(`    cd ${name}`)
  console.log(`    ${packageManager} install`)
  console.log(`    kick g module user`)
  console.log(`    kick dev`)
  console.log()
  console.log('  Commands:')
  console.log('    kick dev         Start dev server with Vite HMR')
  console.log('    kick build       Production build via Vite')
  console.log('    kick start       Run production build')
  console.log('    kick g module X  Generate a DDD module')
  console.log()
}
