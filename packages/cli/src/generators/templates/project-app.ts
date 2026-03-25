type ProjectTemplate = 'rest' | 'graphql' | 'ddd' | 'cqrs' | 'minimal'

/** Generate src/index.ts entry file with template-specific bootstrap */
export function generateEntryFile(
  name: string,
  template: ProjectTemplate,
  version: string,
): string {
  switch (template) {
    case 'graphql':
      return `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
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

    case 'cqrs':
      return `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { OtelAdapter } from '@forinda/kickjs-otel'
// import { WsAdapter } from '@forinda/kickjs-ws'
// import { QueueAdapter, BullMQProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

bootstrap({
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
import { bootstrap } from '@forinda/kickjs-http'
import { modules } from './modules'

bootstrap({ modules })
`

    case 'ddd':
    case 'rest':
    default:
      return `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: '${name}', version: '${version}' },
    }),
  ],
})
`
  }
}

/** Generate src/modules/index.ts module registry */
export function generateModulesIndex(): string {
  return `import type { AppModuleClass } from '@forinda/kickjs-core'

export const modules: AppModuleClass[] = []
`
}

/** Generate kick.config.ts CLI configuration */
export function generateKickConfig(
  template: ProjectTemplate,
  defaultRepo: string = 'inmemory',
): string {
  return `import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: '${template}',
  modules: {
    dir: 'src/modules',
    repo: '${defaultRepo}',
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
