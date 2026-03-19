import { join } from 'node:path'
import { writeFileSafe, fileExists } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase, pluralize, pluralizePascal } from '../utils/naming'
import { readFile, writeFile } from 'node:fs/promises'

interface GenerateModuleOptions {
  name: string
  modulesDir: string
  noEntity?: boolean
  noTests?: boolean
  repo?: 'drizzle' | 'inmemory'
  minimal?: boolean
}

/**
 * Generate a full DDD module with all layers:
 *   presentation/    — controller
 *   application/     — use-cases, DTOs
 *   domain/          — entity, value objects, repository interface, domain service
 *   infrastructure/  — repository implementation
 */
export async function generateModule(options: GenerateModuleOptions): Promise<string[]> {
  const { name, modulesDir, noEntity, noTests, repo = 'inmemory', minimal } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const camel = toCamelCase(name)
  const plural = pluralize(kebab)
  const pluralPascal = pluralizePascal(pascal)
  const moduleDir = join(modulesDir, plural)

  const files: string[] = []

  const write = async (relativePath: string, content: string) => {
    const fullPath = join(moduleDir, relativePath)
    await writeFileSafe(fullPath, content)
    files.push(fullPath)
  }

  // ── Module Index ────────────────────────────────────────────────────
  await write(
    'index.ts',
    `/**
 * ${pascal} Module
 *
 * Self-contained feature module following Domain-Driven Design (DDD).
 * Registers dependencies in the DI container and declares HTTP routes.
 *
 * Structure:
 *   presentation/    — HTTP controllers (entry points)
 *   application/     — Use cases (orchestration) and DTOs (validation)
 *   domain/          — Entities, value objects, repository interfaces, domain services
 *   infrastructure/  — Repository implementations (in-memory, Drizzle, Prisma, etc.)
 */
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { ${pascal.toUpperCase()}_REPOSITORY } from './domain/repositories/${kebab}.repository'
import { ${repo === 'inmemory' ? `InMemory${pascal}Repository` : `Drizzle${pascal}Repository`} } from './infrastructure/repositories/${repo === 'inmemory' ? `in-memory-${kebab}` : `drizzle-${kebab}`}.repository'
import { ${pascal}Controller } from './presentation/${kebab}.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class ${pascal}Module implements AppModule {
  /**
   * Register module dependencies in the DI container.
   * Bind repository interface tokens to their implementations here.
   * To swap implementations (e.g. in-memory -> Drizzle), change the factory target.
   */
  register(container: Container): void {
    container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
      container.resolve(${repo === 'inmemory' ? `InMemory${pascal}Repository` : `Drizzle${pascal}Repository`}),
    )
  }

  /**
   * Declare HTTP routes for this module.
   * The path is prefixed with the global apiPrefix and version (e.g. /api/v1/${plural}).
   * Passing 'controller' enables automatic OpenAPI spec generation via SwaggerAdapter.
   */
  routes(): ModuleRoutes {
    return {
      path: '/${plural}',
      router: buildRoutes(${pascal}Controller),
      controller: ${pascal}Controller,
    }
  }
}
`,
  )

  // ── Controller ──────────────────────────────────────────────────────
  await write(
    `presentation/${kebab}.controller.ts`,
    `/**
 * ${pascal} Controller
 *
 * Presentation layer — handles HTTP requests and delegates to use cases.
 * Each method receives a RequestContext with typed body, params, and query.
 *
 * Decorators:
 *   @Controller(path?) — registers this class as an HTTP controller
 *   @Get/@Post/@Put/@Delete(path?, validation?) — defines routes with optional Zod validation
 *   @Autowired() — injects dependencies lazily from the DI container
 *   @Middleware(...handlers) — attach middleware at class or method level
 *
 * Add Swagger decorators (@ApiTags, @ApiOperation, @ApiResponse) from @forinda/kickjs-swagger
 * for automatic OpenAPI documentation.
 */
import { Controller, Get, Post, Put, Delete, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import { Create${pascal}UseCase } from '../application/use-cases/create-${kebab}.use-case'
import { Get${pascal}UseCase } from '../application/use-cases/get-${kebab}.use-case'
import { List${pluralPascal}UseCase } from '../application/use-cases/list-${plural}.use-case'
import { Update${pascal}UseCase } from '../application/use-cases/update-${kebab}.use-case'
import { Delete${pascal}UseCase } from '../application/use-cases/delete-${kebab}.use-case'
import { create${pascal}Schema } from '../application/dtos/create-${kebab}.dto'
import { update${pascal}Schema } from '../application/dtos/update-${kebab}.dto'

@Controller()
export class ${pascal}Controller {
  @Autowired() private create${pascal}UseCase!: Create${pascal}UseCase
  @Autowired() private get${pascal}UseCase!: Get${pascal}UseCase
  @Autowired() private list${pluralPascal}UseCase!: List${pluralPascal}UseCase
  @Autowired() private update${pascal}UseCase!: Update${pascal}UseCase
  @Autowired() private delete${pascal}UseCase!: Delete${pascal}UseCase

  @Post('/', { body: create${pascal}Schema })
  async create(ctx: RequestContext) {
    const result = await this.create${pascal}UseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.list${pluralPascal}UseCase.execute()
    ctx.json(result)
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.get${pascal}UseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('${pascal} not found')
    ctx.json(result)
  }

  @Put('/:id', { body: update${pascal}Schema })
  async update(ctx: RequestContext) {
    const result = await this.update${pascal}UseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.delete${pascal}UseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
`,
  )

  // ── DTOs ────────────────────────────────────────────────────────────
  await write(
    `application/dtos/create-${kebab}.dto.ts`,
    `import { z } from 'zod'

/**
 * Create ${pascal} DTO — Zod schema for validating POST request bodies.
 * This schema is passed to @Post('/', { body: create${pascal}Schema }) for automatic validation.
 * It also generates OpenAPI request body docs when SwaggerAdapter is used.
 *
 * Add more fields as needed. Supported Zod types:
 *   z.string(), z.number(), z.boolean(), z.enum([...]),
 *   z.array(), z.object(), .optional(), .default(), .transform()
 */
export const create${pascal}Schema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
})

export type Create${pascal}DTO = z.infer<typeof create${pascal}Schema>
`,
  )

  await write(
    `application/dtos/update-${kebab}.dto.ts`,
    `import { z } from 'zod'

export const update${pascal}Schema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type Update${pascal}DTO = z.infer<typeof update${pascal}Schema>
`,
  )

  await write(
    `application/dtos/${kebab}-response.dto.ts`,
    `export interface ${pascal}ResponseDTO {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
`,
  )

  // ── Use Cases ───────────────────────────────────────────────────────
  const useCases = [
    {
      file: `create-${kebab}.use-case.ts`,
      content: `/**
 * Create ${pascal} Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { Create${pascal}DTO } from '../dtos/create-${kebab}.dto'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class Create${pascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return this.repo.create(dto)
  }
}
`,
    },
    {
      file: `get-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class Get${pascal}UseCase {
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
      file: `list-${plural}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class List${pluralPascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(): Promise<${pascal}ResponseDTO[]> {
    return this.repo.findAll()
  }
}
`,
    },
    {
      file: `update-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { Update${pascal}DTO } from '../dtos/update-${kebab}.dto'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class Update${pascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return this.repo.update(id, dto)
  }
}
`,
    },
    {
      file: `delete-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'

@Service()
export class Delete${pascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
`,
    },
  ]

  for (const uc of useCases) {
    await write(`application/use-cases/${uc.file}`, uc.content)
  }

  // ── Domain: Repository Interface ────────────────────────────────────
  await write(
    `domain/repositories/${kebab}.repository.ts`,
    `/**
 * ${pascal} Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { ${pascal}ResponseDTO } from '../../application/dtos/${kebab}-response.dto'
import type { Create${pascal}DTO } from '../../application/dtos/create-${kebab}.dto'
import type { Update${pascal}DTO } from '../../application/dtos/update-${kebab}.dto'

export interface I${pascal}Repository {
  findById(id: string): Promise<${pascal}ResponseDTO | null>
  findAll(): Promise<${pascal}ResponseDTO[]>
  create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO>
  update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO>
  delete(id: string): Promise<void>
}

export const ${pascal.toUpperCase()}_REPOSITORY = Symbol('I${pascal}Repository')
`,
  )

  // ── Domain: Service ─────────────────────────────────────────────────
  await write(
    `domain/services/${kebab}-domain.service.ts`,
    `/**
 * ${pascal} Domain Service
 *
 * Domain layer — contains business rules that don't belong to a single entity.
 * Use this for cross-entity logic, validation rules, and domain invariants.
 * Keep it free of HTTP/framework concerns.
 */
import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../repositories/${kebab}.repository'

@Service()
export class ${pascal}DomainService {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('${pascal} not found')
    }
  }
}
`,
  )

  // ── Infrastructure: Repository Implementation ──────────────────────
  if (repo === 'inmemory') {
    await write(
      `infrastructure/repositories/in-memory-${kebab}.repository.ts`,
      `/**
 * In-Memory ${pascal} Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '../../application/dtos/${kebab}-response.dto'
import type { Create${pascal}DTO } from '../../application/dtos/create-${kebab}.dto'
import type { Update${pascal}DTO } from '../../application/dtos/update-${kebab}.dto'

@Repository()
export class InMemory${pascal}Repository implements I${pascal}Repository {
  private store = new Map<string, ${pascal}ResponseDTO>()

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const now = new Date().toISOString()
    const entity: ${pascal}ResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('${pascal} not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('${pascal} not found')
    this.store.delete(id)
  }
}
`,
    )
  }

  // ── Entity & Value Objects ──────────────────────────────────────────
  if (!noEntity && !minimal) {
    await write(
      `domain/entities/${kebab}.entity.ts`,
      `/**
 * ${pascal} Entity
 *
 * Domain layer — the core business object.
 * Uses a private constructor with static factory methods (create, reconstitute)
 * to enforce invariants. Properties are accessed via getters to maintain encapsulation.
 *
 * Patterns used:
 *   - Private constructor: prevents direct instantiation
 *   - create(): factory for new entities (generates ID, sets timestamps)
 *   - reconstitute(): factory for rebuilding from persistence (no side effects)
 *   - changeName(): mutation method that enforces business rules
 */
import { ${pascal}Id } from '../value-objects/${kebab}-id.vo'

interface ${pascal}Props {
  id: ${pascal}Id
  name: string
  createdAt: Date
  updatedAt: Date
}

export class ${pascal} {
  private constructor(private props: ${pascal}Props) {}

  static create(params: { name: string }): ${pascal} {
    const now = new Date()
    return new ${pascal}({
      id: ${pascal}Id.create(),
      name: params.name,
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: ${pascal}Props): ${pascal} {
    return new ${pascal}(props)
  }

  get id(): ${pascal}Id {
    return this.props.id
  }
  get name(): string {
    return this.props.name
  }
  get createdAt(): Date {
    return this.props.createdAt
  }
  get updatedAt(): Date {
    return this.props.updatedAt
  }

  changeName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Name cannot be empty')
    }
    this.props.name = name.trim()
    this.props.updatedAt = new Date()
  }

  toJSON() {
    return {
      id: this.props.id.toString(),
      name: this.props.name,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    }
  }
}
`,
    )

    await write(
      `domain/value-objects/${kebab}-id.vo.ts`,
      `/**
 * ${pascal} ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   ${pascal}Id.create()    — generate a new UUID
 *   ${pascal}Id.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class ${pascal}Id {
  private constructor(private readonly value: string) {}

  static create(): ${pascal}Id {
    return new ${pascal}Id(randomUUID())
  }

  static from(id: string): ${pascal}Id {
    if (!id || id.trim().length === 0) {
      throw new Error('${pascal}Id cannot be empty')
    }
    return new ${pascal}Id(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: ${pascal}Id): boolean {
    return this.value === other.value
  }
}
`,
    )
  }

  // ── Auto-register in modules index ──────────────────────────────────
  await autoRegisterModule(modulesDir, pascal, plural)

  return files
}

/** Add the new module to src/modules/index.ts */
async function autoRegisterModule(
  modulesDir: string,
  pascal: string,
  plural: string,
): Promise<void> {
  const indexPath = join(modulesDir, 'index.ts')
  const exists = await fileExists(indexPath)

  if (!exists) {
    await writeFileSafe(
      indexPath,
      `import type { AppModuleClass } from '@forinda/kickjs-core'
import { ${pascal}Module } from './${plural}'

export const modules: AppModuleClass[] = [${pascal}Module]
`,
    )
    return
  }

  let content = await readFile(indexPath, 'utf-8')

  // Add import if not present
  const importLine = `import { ${pascal}Module } from './${plural}'`
  if (!content.includes(`${pascal}Module`)) {
    // Insert import after last existing import
    const lastImportIdx = content.lastIndexOf('import ')
    if (lastImportIdx !== -1) {
      const lineEnd = content.indexOf('\n', lastImportIdx)
      content = content.slice(0, lineEnd + 1) + importLine + '\n' + content.slice(lineEnd + 1)
    } else {
      content = importLine + '\n' + content
    }

    // Add to modules array — handle both empty and existing entries
    // Match the array assignment: `= [...]` or `= [\n...\n]`
    content = content.replace(/(=\s*\[)([\s\S]*?)(])/, (_match, open, existing, close) => {
      const trimmed = existing.trim()
      if (!trimmed) {
        // Empty array: `= []`
        return `${open}${pascal}Module${close}`
      }
      // Existing entries: append with comma
      const needsComma = trimmed.endsWith(',') ? '' : ','
      return `${open}${existing.trimEnd()}${needsComma} ${pascal}Module${close}`
    })
  }

  await writeFile(indexPath, content, 'utf-8')
}
