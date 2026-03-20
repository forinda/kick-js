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

  // ── Constants ──────────────────────────────────────────────────────
  await write(
    'constants.ts',
    `import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
`,
  )

  // ── Controller ──────────────────────────────────────────────────────
  await write(
    `presentation/${kebab}.controller.ts`,
    `import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags } from '@forinda/kickjs-swagger'
import { Create${pascal}UseCase } from '../application/use-cases/create-${kebab}.use-case'
import { Get${pascal}UseCase } from '../application/use-cases/get-${kebab}.use-case'
import { List${pluralPascal}UseCase } from '../application/use-cases/list-${plural}.use-case'
import { Update${pascal}UseCase } from '../application/use-cases/update-${kebab}.use-case'
import { Delete${pascal}UseCase } from '../application/use-cases/delete-${kebab}.use-case'
import { create${pascal}Schema } from '../application/dtos/create-${kebab}.dto'
import { update${pascal}Schema } from '../application/dtos/update-${kebab}.dto'
import { ${pascal.toUpperCase()}_QUERY_CONFIG } from '../constants'

@Controller()
export class ${pascal}Controller {
  @Autowired() private create${pascal}UseCase!: Create${pascal}UseCase
  @Autowired() private get${pascal}UseCase!: Get${pascal}UseCase
  @Autowired() private list${pluralPascal}UseCase!: List${pluralPascal}UseCase
  @Autowired() private update${pascal}UseCase!: Update${pascal}UseCase
  @Autowired() private delete${pascal}UseCase!: Delete${pascal}UseCase

  @Get('/')
  @ApiTags('${pascal}')
  @ApiQueryParams(${pascal.toUpperCase()}_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.list${pluralPascal}UseCase.execute(parsed),
      ${pascal.toUpperCase()}_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('${pascal}')
  async getById(ctx: RequestContext) {
    const result = await this.get${pascal}UseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('${pascal} not found')
    ctx.json(result)
  }

  @Post('/', { body: create${pascal}Schema, name: 'Create${pascal}' })
  @ApiTags('${pascal}')
  async create(ctx: RequestContext) {
    const result = await this.create${pascal}UseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: update${pascal}Schema, name: 'Update${pascal}' })
  @ApiTags('${pascal}')
  async update(ctx: RequestContext) {
    const result = await this.update${pascal}UseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('${pascal}')
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
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class List${pluralPascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
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
import type { ParsedQuery } from '@forinda/kickjs-http'

export interface I${pascal}Repository {
  findById(id: string): Promise<${pascal}ResponseDTO | null>
  findAll(): Promise<${pascal}ResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }>
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
import type { ParsedQuery } from '@forinda/kickjs-http'
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

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    const all = Array.from(this.store.values())
    const data = all.slice(parsed.pagination.offset, parsed.pagination.offset + parsed.pagination.limit)
    return { data, total: all.length }
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

  // ── Tests ──────────────────────────────────────────────────────────
  if (!noTests) {
    await write(
      `__tests__/${kebab}.controller.test.ts`,
      `import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs-core'

describe('${pascal}Controller', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('should be defined', () => {
    expect(true).toBe(true)
  })

  describe('POST /${plural}', () => {
    it('should create a new ${kebab}', async () => {
      // TODO: Set up test module, call create endpoint, assert 201
      expect(true).toBe(true)
    })
  })

  describe('GET /${plural}', () => {
    it('should return paginated ${plural}', async () => {
      // TODO: Set up test module, call list endpoint, assert { data, meta }
      expect(true).toBe(true)
    })
  })

  describe('GET /${plural}/:id', () => {
    it('should return a ${kebab} by id', async () => {
      // TODO: Create a ${kebab}, then fetch by id, assert match
      expect(true).toBe(true)
    })

    it('should return 404 for non-existent ${kebab}', async () => {
      // TODO: Fetch non-existent id, assert 404
      expect(true).toBe(true)
    })
  })

  describe('PUT /${plural}/:id', () => {
    it('should update an existing ${kebab}', async () => {
      // TODO: Create, update, assert changes
      expect(true).toBe(true)
    })
  })

  describe('DELETE /${plural}/:id', () => {
    it('should delete a ${kebab}', async () => {
      // TODO: Create, delete, assert gone
      expect(true).toBe(true)
    })
  })
})
`,
    )

    await write(
      `__tests__/${kebab}.repository.test.ts`,
      `import { describe, it, expect, beforeEach } from 'vitest'
import { InMemory${pascal}Repository } from '../infrastructure/repositories/in-memory-${kebab}.repository'

describe('InMemory${pascal}Repository', () => {
  let repo: InMemory${pascal}Repository

  beforeEach(() => {
    repo = new InMemory${pascal}Repository()
  })

  it('should create and retrieve a ${kebab}', async () => {
    const created = await repo.create({ name: 'Test ${pascal}' })
    expect(created).toBeDefined()
    expect(created.name).toBe('Test ${pascal}')
    expect(created.id).toBeDefined()

    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })

  it('should return null for non-existent id', async () => {
    const found = await repo.findById('non-existent')
    expect(found).toBeNull()
  })

  it('should list all ${plural}', async () => {
    await repo.create({ name: '${pascal} 1' })
    await repo.create({ name: '${pascal} 2' })

    const all = await repo.findAll()
    expect(all).toHaveLength(2)
  })

  it('should return paginated results', async () => {
    await repo.create({ name: '${pascal} 1' })
    await repo.create({ name: '${pascal} 2' })
    await repo.create({ name: '${pascal} 3' })

    const result = await repo.findPaginated({
      filters: [],
      sort: [],
      search: '',
      pagination: { page: 1, limit: 2, offset: 0 },
    })

    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(3)
  })

  it('should update a ${kebab}', async () => {
    const created = await repo.create({ name: 'Original' })
    const updated = await repo.update(created.id, { name: 'Updated' })
    expect(updated.name).toBe('Updated')
  })

  it('should delete a ${kebab}', async () => {
    const created = await repo.create({ name: 'To Delete' })
    await repo.delete(created.id)
    const found = await repo.findById(created.id)
    expect(found).toBeNull()
  })
})
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
