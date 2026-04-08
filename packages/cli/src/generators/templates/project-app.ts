type ProjectTemplate = 'rest' | 'graphql' | 'ddd' | 'cqrs' | 'minimal'

/**
 * Generate src/index.ts entry file with template-specific bootstrap.
 *
 * All templates export the app for the Vite plugin (dev mode).
 * In production, bootstrap() auto-starts the HTTP server when
 * `globalThis.__kickjs_httpServer` is not set.
 */
export function generateEntryFile(
  name: string,
  template: ProjectTemplate,
  version: string,
): string {
  switch (template) {
    case 'graphql':
      return `import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { GraphQLAdapter } from '@forinda/kickjs-graphql'
import { modules } from './modules'

// Import your resolvers here
// import { UserResolver } from './resolvers/user.resolver'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({
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

    case 'cqrs':
      return `import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { OtelAdapter } from '@forinda/kickjs-otel'
// import { WsAdapter } from '@forinda/kickjs-ws'
// import { QueueAdapter, BullMQProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({
  modules,
  adapters: [
    new OtelAdapter({ serviceName: '${name}' }),
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: '${name}', version: '${version}' },
    }),
    // Uncomment for WebSocket support:
    // new WsAdapter(),
    // Uncomment when Redis is available:
    // new QueueAdapter({
    //   provider: new BullMQProvider({ host: 'localhost', port: 6379 }),
    // }),
  ],
})
`

    case 'minimal':
      return `import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({ modules })
`

    case 'ddd':
    case 'rest':
    default:
      return `import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
import express from 'express'
import {
  bootstrap,
  requestId,
  requestLogger,
  helmet,
  cors,
} from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: '${name}', version: '${version}' },
    }),
  ],
  middleware: [
    helmet(),
    cors({ origin: '*' }),
    requestId(),
    requestLogger(),
    express.json(),
  ],
})
`
  }
}

/** Generate src/modules/index.ts module registry */
export function generateModulesIndex(): string {
  return `import type { AppModuleClass } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'

// Remove HelloModule and run: kick g module <name>
export const modules: AppModuleClass[] = [HelloModule]
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
export function generateEnvFile(): string {
  return `import { defineEnv, loadEnv } from '@forinda/kickjs/config'
import { z } from 'zod'

/**
 * Project environment schema.
 *
 * Extend the base schema with your application's variables. The
 * default export is the contract \`kick typegen\` reads to populate
 * the global \`KickEnv\` registry — that's what makes \`@Value('FOO')\`
 * autocomplete and \`process.env.FOO\` typed.
 *
 * @example
 *   DATABASE_URL: z.string().url(),
 *   JWT_SECRET: z.string().min(32),
 *   REDIS_URL: z.string().url().optional(),
 */
const envSchema = defineEnv((base) =>
  base.extend({
    // DATABASE_URL: z.string().url(),
  }),
)

/**
 * IMPORTANT — side effect: register the schema with kickjs's env cache
 * **at module-load time**. \`ConfigService\` and \`@Value()\` both consume
 * this cache, and they will fall back to the base schema (or undefined)
 * if no extended schema has been registered before they're resolved.
 *
 * As long as \`src/index.ts\` imports this file (\`import './env'\`) at the
 * top — before \`bootstrap()\` runs — every controller and service in the
 * app sees the typed extended values.
 */
export const env = loadEnv(envSchema)

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
// See https://forinda.github.io/kick-js/guide/typegen.

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
  return `import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { HelloController } from './hello.controller'

export class HelloModule implements AppModule {
  // \`register(container)\` is optional — only implement it when you need
  // to bind a token to a concrete implementation, e.g.
  //   register(container) {
  //     container.registerFactory(USER_REPOSITORY, () => container.resolve(InMemoryUserRepository))
  //   }
  // The HelloService uses @Service() so the decorator handles registration.

  routes(): ModuleRoutes {
    return {
      path: '/hello',
      router: buildRoutes(HelloController),
      controller: HelloController,
    }
  }
}
`
}

/** Generate kick.config.ts CLI configuration */
export function generateKickConfig(
  template: ProjectTemplate,
  defaultRepo: string = 'inmemory',
): string {
  const builtinRepos = ['drizzle', 'inmemory', 'prisma']
  const repoValue = builtinRepos.includes(defaultRepo)
    ? `'${defaultRepo}'`
    : `{ name: '${defaultRepo}' }`

  return `import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: '${template}',
  modules: {
    dir: 'src/modules',
    repo: ${repoValue},
    pluralize: true,
  },

  // \`kick typegen\` populates \`.kickjs/types/\` so \`Ctx<KickRoutes.X['method']>\`
  // resolves to fully-typed params/body/query. Auto-runs on \`kick dev\`.
  // Set \`schemaValidator: false\` to skip schema-driven body typing entirely.
  typegen: {
    schemaValidator: 'zod',
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
      name: 'check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify', 'ci'],
    },
  ],
})
`
}
