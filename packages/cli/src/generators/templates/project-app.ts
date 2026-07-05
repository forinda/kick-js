type ProjectTemplate = 'rest' | 'minimal'
export type ProjectRuntime = 'express' | 'fastify' | 'h3'

/** Per-runtime import source + factory name for the scaffolded `runtime:` option. */
const RUNTIME_FACTORY: Record<ProjectRuntime, { from: string; name: string }> = {
  express: { from: '@forinda/kickjs', name: 'expressRuntime' },
  fastify: { from: '@forinda/kickjs/fastify', name: 'fastifyRuntime' },
  h3: { from: '@forinda/kickjs/h3', name: 'h3Runtime' },
}

/**
 * Generate src/index.ts entry file with template-specific bootstrap.
 *
 * The runtime is always emitted explicitly (`runtime: expressRuntime()` etc.)
 * so the entry file is self-documenting and switching engines is a one-line
 * edit. Fastify / h3 parse bodies natively, so the REST template skips the
 * `express.json()` middleware (and the `express` import) under those engines.
 *
 * All templates export the app for the Vite plugin (dev mode).
 */
export function generateEntryFile(
  name: string,
  template: ProjectTemplate,
  version: string,
  packages: string[] = [],
  runtime: ProjectRuntime = 'express',
): string {
  const factory = RUNTIME_FACTORY[runtime]
  const isExpress = runtime === 'express'

  switch (template) {
    case 'minimal': {
      const imports: string[] = []
      const adapters: string[] = []

      // The runtime factory comes from the core package for Express, or a
      // subpath for Fastify / h3.
      const kickImport = isExpress
        ? `import { bootstrap, ${factory.name} } from '@forinda/kickjs'`
        : `import { bootstrap } from '@forinda/kickjs'\nimport { ${factory.name} } from '${factory.from}'`

      if (packages.includes('swagger')) {
        imports.push(`import { SwaggerAdapter } from '@forinda/kickjs-swagger'`)
        adapters.push(`    SwaggerAdapter({ info: { title: '${name}', version: '${version}' } }),`)
      }
      if (packages.includes('devtools')) {
        imports.push(`import { DevToolsAdapter } from '@forinda/kickjs-devtools'`)
        adapters.push(`    DevToolsAdapter(),`)
      }
      const importsBlock = imports.length ? imports.join('\n') + '\n' : ''
      const adaptersBlock = adapters.length ? `,\n  adapters: [\n${adapters.join('\n')}\n  ]` : ''

      return `import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
${kickImport}
${importsBlock}import { modules } from './modules'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({ modules, runtime: ${factory.name}()${adaptersBlock} })
`
    }

    case 'rest':
    default: {
      // Build adapters based on user-selected packages
      const restImports: string[] = []
      const restAdapters: string[] = []

      if (packages.includes('devtools')) {
        restImports.push(`import { DevToolsAdapter } from '@forinda/kickjs-devtools'`)
        restAdapters.push(`    DevToolsAdapter(),`)
      }
      if (packages.includes('swagger')) {
        restImports.push(`import { SwaggerAdapter } from '@forinda/kickjs-swagger'`)
        restAdapters.push(
          `    SwaggerAdapter({\n      info: { title: '${name}', version: '${version}' },\n    }),`,
        )
      }
      const restImportsBlock = restImports.length ? restImports.join('\n') + '\n' : ''
      const restAdaptersBlock = restAdapters.length
        ? `\n  adapters: [\n${restAdapters.join('\n')}\n  ],`
        : ''

      // Express needs `express.json()` for body parsing; Fastify / h3 parse
      // bodies natively, so adding it would consume the body stream twice.
      const kickNamed = ['bootstrap', 'requestId', 'requestLogger', 'helmet', 'cors']
      if (isExpress) kickNamed.push(factory.name)
      const kickImport = isExpress
        ? `import express from 'express'\nimport {\n  ${kickNamed.join(',\n  ')},\n} from '@forinda/kickjs'`
        : `import {\n  ${kickNamed.join(',\n  ')},\n} from '@forinda/kickjs'\nimport { ${factory.name} } from '${factory.from}'`
      const bodyParserLine = isExpress ? `\n    express.json(),` : ''

      return `import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
${kickImport}
${restImportsBlock}import { modules } from './modules'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({
  modules,
  runtime: ${factory.name}(),${restAdaptersBlock}
  middleware: [
    helmet(),
    cors({ origin: '*' }),
    requestId(),
    requestLogger(),${bodyParserLine}
  ],
})
`
    }
  }
}

/** Generate src/modules/index.ts module registry */
export function generateModulesIndex(): string {
  return `import { defineModules } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'

// Remove HelloModule and run: kick g module <name>
// \`defineModules()\` returns a chainable list — \`kick g module\` appends
// \`.mount(NewModule())\` to the chain on every generation.
export const modules = defineModules().mount(HelloModule())
`
}

/**
 * Generate `src/config/index.ts` — the project's typed env schema.
 *
 * Default-exports a `defineEnv(...)` schema so `kick typegen` can
 * infer it into the global `KickEnv` registry, and *also* calls
 * `loadEnv(envSchema)` as a module-load side effect so `ConfigService`
 * and `@Value()` see the extended shape from the very first DI
 * resolution. The companion `src/index.ts` template adds
 * `import './config'` immediately after `reflect-metadata` so the
 * registration runs before `bootstrap()` constructs anything.
 *
 * After typegen runs:
 *
 *   @Value('DATABASE_URL') private url!: Env<'DATABASE_URL'>
 *   process.env.DATABASE_URL  // typed as string
 *
 * Both autocomplete and type-check at compile time.
 */
export function generateEnvFile(schemaLib: 'zod' | 'valibot' | 'yup' = 'zod'): string {
  if (schemaLib === 'valibot') {
    return `import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'

/**
 * Project environment schema (Valibot).
 *
 * \`fromValibot\` wraps the Valibot schema as a \`KickSchema\` so the
 * env loader, validate middleware, and swagger spec generator all see
 * the same shape. The default export is the contract \`kick typegen\`
 * reads to populate \`KickEnv\` via \`InferSchemaOutput<typeof _envSchema>\`
 * — that's what makes \`@Value('FOO')\` autocomplete and
 * \`process.env.FOO\` typed.
 *
 * @example
 *   DATABASE_URL: v.pipe(v.string(), v.url()),
 *   JWT_SECRET:   v.pipe(v.string(), v.minLength(32)),
 *   REDIS_URL:    v.optional(v.pipe(v.string(), v.url())),
 */
const envSchema = fromValibot(
  v.object({
    PORT: v.optional(v.pipe(v.string(), v.transform(Number)), '3000'),
    NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
    LOG_LEVEL: v.optional(v.string(), 'info'),
    // DATABASE_URL: v.pipe(v.string(), v.url()),
  }),
)

/**
 * IMPORTANT — side effect: register the schema with kickjs's env cache
 * **at module-load time**. \`ConfigService\` and \`@Value()\` both consume
 * this cache, and they will fall back to the base schema (or undefined)
 * if no extended schema has been registered before they're resolved.
 *
 * As long as \`src/index.ts\` imports this file (\`import './config'\`) at
 * the top — before \`bootstrap()\` runs — every controller and service
 * in the app sees the typed extended values.
 */
export const env = loadEnvFromSchema(envSchema)

export default envSchema
`
  }

  if (schemaLib === 'yup') {
    return `import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromYup } from '@forinda/kickjs-schema/yup'
import * as yup from 'yup'

/**
 * Project environment schema (Yup).
 *
 * \`fromYup\` wraps the Yup schema as a \`KickSchema\` so the env loader,
 * validate middleware, and swagger spec generator all see the same
 * shape. The default export is the contract \`kick typegen\` reads to
 * populate \`KickEnv\` via \`InferSchemaOutput<typeof _envSchema>\`.
 *
 * Note: Yup's \`.url()\` defaults to http/https; database connection
 * strings like \`postgres://\` use \`.matches(/^[a-z]+:\\/\\/.+/i)\` or
 * a plain \`.string().required()\`.
 *
 * @example
 *   DATABASE_URL: yup.string().required(),
 *   JWT_SECRET:   yup.string().min(32).required(),
 *   REDIS_URL:    yup.string().url().optional(),
 */
const envSchema = fromYup(
  yup.object({
    PORT: yup.number().default(3000),
    NODE_ENV: yup
      .string()
      .oneOf(['development', 'production', 'test'])
      .default('development'),
    LOG_LEVEL: yup.string().default('info'),
    // DATABASE_URL: yup.string().required(),
  }),
)

/**
 * IMPORTANT — side effect: register the schema with kickjs's env cache
 * **at module-load time**. \`ConfigService\` and \`@Value()\` both consume
 * this cache, and they will fall back to the base schema (or undefined)
 * if no extended schema has been registered before they're resolved.
 *
 * As long as \`src/index.ts\` imports this file (\`import './config'\`) at
 * the top — before \`bootstrap()\` runs — every controller and service
 * in the app sees the typed extended values.
 */
export const env = loadEnvFromSchema(envSchema)

export default envSchema
`
  }

  // zod (default)
  return `import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

/**
 * Project environment schema (Zod).
 *
 * \`fromZod\` wraps the Zod schema as a \`KickSchema\` so the env loader,
 * validate middleware, and swagger spec generator all see the same
 * shape. The default export is the contract \`kick typegen\` reads to
 * populate \`KickEnv\` via \`InferSchemaOutput<typeof _envSchema>\` —
 * that's what makes \`@Value('FOO')\` autocomplete and
 * \`process.env.FOO\` typed.
 *
 * @example
 *   DATABASE_URL: z.string().url(),
 *   JWT_SECRET: z.string().min(32),
 *   REDIS_URL: z.string().url().optional(),
 */
const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    // DATABASE_URL: z.string().url(),
  }),
)

/**
 * IMPORTANT — side effect: register the schema with kickjs's env cache
 * **at module-load time**. \`ConfigService\` and \`@Value()\` both consume
 * this cache, and they will fall back to the base schema (or undefined)
 * if no extended schema has been registered before they're resolved.
 *
 * As long as \`src/index.ts\` imports this file (\`import './config'\`) at
 * the top — before \`bootstrap()\` runs — every controller and service
 * in the app sees the typed extended values.
 */
export const env = loadEnvFromSchema(envSchema)

export default envSchema
`
}

/** Generate src/modules/hello/hello.service.ts */
export function generateHelloService(): string {
  return `import { Service } from '@forinda/kickjs'

@Service()
export class HelloService {
  greet(name: string) {
    return { message: \`Hello \${name} from KickJS!\`, timestamp: new Date().toISOString() }
  }

  healthCheck() {
    return { status: 'ok', uptime: process.uptime() }
  }
}
`
}

/** Generate src/modules/hello/hello.controller.ts */
export function generateHelloController(): string {
  return `import { Controller, Get, Autowired, type Ctx } from '@forinda/kickjs'
import { HelloService } from './hello.service'

// \`Ctx<KickRoutes.HelloController['<method>']>\` is generated by
// \`kick typegen\` (auto-run on \`kick dev\`). The first run after a fresh
// scaffold creates \`.kickjs/types/routes.ts\` so this file typechecks.
// See https://kickjs.app/guide/typegen.

@Controller()
export class HelloController {
  @Autowired() private readonly helloService!: HelloService

  @Get('/')
  index(ctx: Ctx<KickRoutes.HelloController['index']>) {
    ctx.json(this.helloService.greet('World'))
  }

  @Get('/health')
  health(ctx: Ctx<KickRoutes.HelloController['health']>) {
    ctx.json(this.helloService.healthCheck())
  }
}
`
}

/** Generate src/modules/hello/hello.module.ts */
export function generateHelloModule(): string {
  return `import { defineModule } from '@forinda/kickjs'
import { HelloController } from './hello.controller'

export const HelloModule = defineModule({
  name: 'HelloModule',
  build: () => ({
    // \`register(container)\` is optional — only implement it when you need
    // to bind a token to a concrete implementation, e.g.
    //   register(container) {
    //     container.registerFactory(USER_REPOSITORY, () => container.resolve(InMemoryUserRepository))
    //   }
    // The HelloService uses @Service() so the decorator handles registration.

    routes() {
      return {
        path: '/hello',
        controller: HelloController,
      }
    },
  }),
})
`
}

/** Generate kick.config.ts CLI configuration */
export function generateKickConfig(
  template: ProjectTemplate,
  defaultRepo: string = 'inmemory',
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' = 'pnpm',
  runtime: 'express' | 'fastify' | 'h3' = 'express',
): string {
  // `inmemory` is the only built-in; every other name (incl. the
  // deprecated prisma/drizzle) is emitted as a `{ name }` custom repo.
  const repoValue = defaultRepo === 'inmemory' ? `'inmemory'` : `{ name: '${defaultRepo}' }`

  return `import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: '${template}',
  // The HTTP engine this app boots on (matches \`bootstrap({ runtime })\` in
  // src/index.ts). Dep-aware commands read it: \`kick add upload\` installs the
  // engine's multipart driver, \`kick doctor\` checks the engine peers, and
  // \`kick typegen\` flips the runtime escape-hatch types to this engine.
  runtime: '${runtime}',
  // Pinned so \`kick add\` and other dep-installing commands always use the
  // project's intended package manager, regardless of which lockfile exists.
  packageManager: '${packageManager}',
  modules: {
    dir: 'src/modules',
    repo: ${repoValue},
    pluralize: true,
  },

  // \`kick typegen\` populates \`.kickjs/types/\` so \`Ctx<KickRoutes.X['method']>\`
  // resolves to fully-typed params/body/query. Auto-runs on \`kick dev\`.
  // \`'kickjs-schema'\` routes inference through \`InferSchemaOutput\` so the
  // typegen works for any wrapped schema (Zod / Valibot / Yup). Switch
  // to \`'zod'\` if you ship Zod schemas without \`fromZod()\` wrapping, or
  // set \`schemaValidator: false\` to skip schema-driven body typing.
  typegen: {
    schemaValidator: 'kickjs-schema',
  },

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
      name: 'ci:check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify'],
    },
  ],
})
`
}
