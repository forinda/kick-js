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
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({ modules })
`

    case 'ddd':
    case 'rest':
    default:
      return `import 'reflect-metadata'
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
  return `import { Controller, Get, Autowired, type RequestContext } from '@forinda/kickjs'
import { HelloService } from './hello.service'

@Controller()
export class HelloController {
  @Autowired() private helloService!: HelloService

  @Get('/')
  index(ctx: RequestContext) {
    ctx.json(this.helloService.greet('World'))
  }

  @Get('/health')
  health(ctx: RequestContext) {
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
