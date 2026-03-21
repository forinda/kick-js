/** CQRS module index — commands, queries, events, WebSocket + queue integration */
export function generateCqrsModuleIndex(
  pascal: string,
  kebab: string,
  plural: string,
  repo: string,
): string {
  const repoClassMap: Record<string, string> = {
    inmemory: `InMemory${pascal}Repository`,
    drizzle: `Drizzle${pascal}Repository`,
    prisma: `Prisma${pascal}Repository`,
  }
  const repoFileMap: Record<string, string> = {
    inmemory: `in-memory-${kebab}`,
    drizzle: `drizzle-${kebab}`,
    prisma: `prisma-${kebab}`,
  }
  const repoClass = repoClassMap[repo] ?? repoClassMap.inmemory
  const repoFile = repoFileMap[repo] ?? repoFileMap.inmemory

  return `/**
 * ${pascal} Module — CQRS Pattern
 *
 * Separates read (queries) and write (commands) operations.
 * Events are emitted after state changes and can be handled via
 * WebSocket broadcasts, queue jobs, or ETL pipelines.
 *
 * Structure:
 *   commands/       — Write operations (create, update, delete)
 *   queries/        — Read operations (get, list)
 *   events/         — Domain events + handlers (WS broadcast, queue dispatch)
 *   dtos/           — Request/response schemas
 */
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { ${pascal.toUpperCase()}_REPOSITORY } from './${kebab}.repository'
import { ${repoClass} } from './${repoFile}.repository'
import { ${pascal}Controller } from './${kebab}.controller'

// Eagerly load decorated classes
import.meta.glob(
  [
    './commands/**/*.ts',
    './queries/**/*.ts',
    './events/**/*.ts',
    '!./**/*.test.ts',
  ],
  { eager: true },
)

export class ${pascal}Module implements AppModule {
  register(container: Container): void {
    container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
      container.resolve(${repoClass}),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/${plural}',
      router: buildRoutes(${pascal}Controller),
      controller: ${pascal}Controller,
    }
  }
}
`
}

/** CQRS controller — dispatches to command/query handlers */
export function generateCqrsController(
  pascal: string,
  kebab: string,
  plural: string,
  pluralPascal: string,
): string {
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1)
  return `import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags } from '@forinda/kickjs-swagger'
import { Create${pascal}Command } from './commands/create-${kebab}.command'
import { Update${pascal}Command } from './commands/update-${kebab}.command'
import { Delete${pascal}Command } from './commands/delete-${kebab}.command'
import { Get${pascal}Query } from './queries/get-${kebab}.query'
import { List${pluralPascal}Query } from './queries/list-${plural}.query'
import { create${pascal}Schema } from './dtos/create-${kebab}.dto'
import { update${pascal}Schema } from './dtos/update-${kebab}.dto'
import { ${pascal.toUpperCase()}_QUERY_CONFIG } from './${kebab}.constants'

@Controller()
export class ${pascal}Controller {
  @Autowired() private create${pascal}Command!: Create${pascal}Command
  @Autowired() private update${pascal}Command!: Update${pascal}Command
  @Autowired() private delete${pascal}Command!: Delete${pascal}Command
  @Autowired() private get${pascal}Query!: Get${pascal}Query
  @Autowired() private list${pluralPascal}Query!: List${pluralPascal}Query

  @Get('/')
  @ApiTags('${pascal}')
  @ApiQueryParams(${pascal.toUpperCase()}_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.list${pluralPascal}Query.execute(parsed),
      ${pascal.toUpperCase()}_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('${pascal}')
  async getById(ctx: RequestContext) {
    const result = await this.get${pascal}Query.execute(ctx.params.id)
    if (!result) return ctx.notFound('${pascal} not found')
    ctx.json(result)
  }

  @Post('/', { body: create${pascal}Schema, name: 'Create${pascal}' })
  @ApiTags('${pascal}')
  async create(ctx: RequestContext) {
    const result = await this.create${pascal}Command.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: update${pascal}Schema, name: 'Update${pascal}' })
  @ApiTags('${pascal}')
  async update(ctx: RequestContext) {
    const result = await this.update${pascal}Command.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('${pascal}')
  async remove(ctx: RequestContext) {
    await this.delete${pascal}Command.execute(ctx.params.id)
    ctx.noContent()
  }
}
`
}

/** CQRS commands — write operations that emit events */
export function generateCqrsCommands(
  pascal: string,
  kebab: string,
): { file: string; content: string }[] {
  return [
    {
      file: `create-${kebab}.command.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../${kebab}.repository'
import type { Create${pascal}DTO } from '../dtos/create-${kebab}.dto'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'
import { ${pascal}Events } from '../events/${kebab}.events'

@Service()
export class Create${pascal}Command {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
    @Inject(${pascal}Events) private readonly events: ${pascal}Events,
  ) {}

  async execute(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const result = await this.repo.create(dto)
    this.events.emit('${kebab}.created', result)
    return result
  }
}
`,
    },
    {
      file: `update-${kebab}.command.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../${kebab}.repository'
import type { Update${pascal}DTO } from '../dtos/update-${kebab}.dto'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'
import { ${pascal}Events } from '../events/${kebab}.events'

@Service()
export class Update${pascal}Command {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
    @Inject(${pascal}Events) private readonly events: ${pascal}Events,
  ) {}

  async execute(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const result = await this.repo.update(id, dto)
    this.events.emit('${kebab}.updated', result)
    return result
  }
}
`,
    },
    {
      file: `delete-${kebab}.command.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../${kebab}.repository'
import { ${pascal}Events } from '../events/${kebab}.events'

@Service()
export class Delete${pascal}Command {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
    @Inject(${pascal}Events) private readonly events: ${pascal}Events,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
    this.events.emit('${kebab}.deleted', { id })
  }
}
`,
    },
  ]
}

/** CQRS queries — read operations */
export function generateCqrsQueries(
  pascal: string,
  kebab: string,
  plural: string,
  pluralPascal: string,
): { file: string; content: string }[] {
  return [
    {
      file: `get-${kebab}.query.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../${kebab}.repository'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class Get${pascal}Query {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(id: string): Promise<${pascal}ResponseDTO | null> {
    return this.repo.findById(id)
  }
}
`,
    },
    {
      file: `list-${plural}.query.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../${kebab}.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class List${pluralPascal}Query {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
`,
    },
  ]
}

/** CQRS events — domain event emitter + handler with WS/queue integration */
export function generateCqrsEvents(
  pascal: string,
  kebab: string,
): { file: string; content: string }[] {
  return [
    {
      file: `${kebab}.events.ts`,
      content: `import { Service } from '@forinda/kickjs-core'
import { EventEmitter } from 'node:events'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

/**
 * ${pascal} domain event types.
 *
 * These events are emitted by commands after state changes.
 * Subscribe to them in event handlers for side effects:
 *   - WebSocket broadcasts (real-time UI updates)
 *   - Queue jobs (async processing, ETL pipelines)
 *   - Audit logging
 *   - Cache invalidation
 */
export interface ${pascal}EventMap {
  '${kebab}.created': ${pascal}ResponseDTO
  '${kebab}.updated': ${pascal}ResponseDTO
  '${kebab}.deleted': { id: string }
}

@Service()
export class ${pascal}Events {
  private emitter = new EventEmitter()

  emit<K extends keyof ${pascal}EventMap>(event: K, data: ${pascal}EventMap[K]): void {
    this.emitter.emit(event, data)
  }

  on<K extends keyof ${pascal}EventMap>(event: K, handler: (data: ${pascal}EventMap[K]) => void): void {
    this.emitter.on(event, handler)
  }

  off<K extends keyof ${pascal}EventMap>(event: K, handler: (data: ${pascal}EventMap[K]) => void): void {
    this.emitter.off(event, handler)
  }
}
`,
    },
    {
      file: `on-${kebab}-change.handler.ts`,
      content: `import { Service, Autowired } from '@forinda/kickjs-core'
import { ${pascal}Events } from './${kebab}.events'

/**
 * ${pascal} Change Event Handler
 *
 * Reacts to domain events emitted by commands.
 * Wire up side effects here:
 *
 * 1. WebSocket broadcast — notify connected clients in real-time
 *    import { WsGateway } from '@forinda/kickjs-ws'
 *    this.ws.broadcast('${kebab}-channel', { event, data })
 *
 * 2. Queue dispatch — offload heavy processing to background workers
 *    import { QueueService } from '@forinda/kickjs-queue'
 *    this.queue.add('${kebab}-etl', { action: event, payload: data })
 *
 * 3. ETL pipeline — transform and load data to external systems
 *    await this.etlPipeline.process(data)
 */
@Service()
export class On${pascal}ChangeHandler {
  @Autowired() private events!: ${pascal}Events

  // Uncomment to inject WebSocket and Queue services:
  // @Autowired() private ws!: WsGateway
  // @Autowired() private queue!: QueueService

  onInit(): void {
    this.events.on('${kebab}.created', (data) => {
      console.log('[${pascal}] Created:', data.id)
      // TODO: Broadcast via WebSocket
      // this.ws.broadcast('${kebab}-channel', { event: '${kebab}.created', data })
      // TODO: Dispatch to queue for async processing / ETL
      // this.queue.add('${kebab}-etl', { action: 'create', payload: data })
    })

    this.events.on('${kebab}.updated', (data) => {
      console.log('[${pascal}] Updated:', data.id)
      // TODO: Broadcast via WebSocket
      // this.ws.broadcast('${kebab}-channel', { event: '${kebab}.updated', data })
    })

    this.events.on('${kebab}.deleted', (data) => {
      console.log('[${pascal}] Deleted:', data.id)
      // TODO: Broadcast via WebSocket
      // this.ws.broadcast('${kebab}-channel', { event: '${kebab}.deleted', data })
    })
  }
}
`,
    },
  ]
}
