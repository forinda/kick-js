import { join } from 'node:path'
import { writeFileSafe, fileExists } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase, pluralize, pluralizePascal } from '../utils/naming'
import { readFile, writeFile } from 'node:fs/promises'

// ── Field Parsing ───────────────────────────────────────────────────────

export interface FieldDef {
  name: string
  type: string
  tsType: string
  zodType: string
  optional: boolean
}

/**
 * Supported field types and their mappings:
 *   string    → z.string()
 *   text      → z.string()        (alias, hints at longer content)
 *   number    → z.number()
 *   int       → z.number().int()
 *   float     → z.number()
 *   boolean   → z.boolean()
 *   date      → z.string().datetime()
 *   email     → z.string().email()
 *   url       → z.string().url()
 *   uuid      → z.string().uuid()
 *   json      → z.any()
 *   enum:a,b  → z.enum(['a','b'])
 *
 * Append ? for optional: title:string  body:text?  published:boolean?
 */
const TYPE_MAP: Record<string, { ts: string; zod: string }> = {
  string: { ts: 'string', zod: 'z.string()' },
  text: { ts: 'string', zod: 'z.string()' },
  number: { ts: 'number', zod: 'z.number()' },
  int: { ts: 'number', zod: 'z.number().int()' },
  float: { ts: 'number', zod: 'z.number()' },
  boolean: { ts: 'boolean', zod: 'z.boolean()' },
  date: { ts: 'string', zod: 'z.string().datetime()' },
  email: { ts: 'string', zod: 'z.string().email()' },
  url: { ts: 'string', zod: 'z.string().url()' },
  uuid: { ts: 'string', zod: 'z.string().uuid()' },
  json: { ts: 'any', zod: 'z.any()' },
}

export function parseFields(raw: string[]): FieldDef[] {
  return raw.map((f) => {
    const colonIdx = f.indexOf(':')
    if (colonIdx === -1) {
      throw new Error(`Invalid field: "${f}". Use format: name:type (e.g. title:string)`)
    }
    const namePart = f.slice(0, colonIdx)
    const typePart = f.slice(colonIdx + 1)
    if (!namePart || !typePart) {
      throw new Error(`Invalid field: "${f}". Use format: name:type (e.g. title:string)`)
    }

    const optional = typePart.endsWith('?')
    const cleanType = optional ? typePart.slice(0, -1) : typePart

    // Handle enum:val1,val2
    if (cleanType.startsWith('enum:')) {
      const values = cleanType.slice(5).split(',')
      return {
        name: namePart,
        type: 'enum',
        tsType: values.map((v) => `'${v}'`).join(' | '),
        zodType: `z.enum([${values.map((v) => `'${v}'`).join(', ')}])`,
        optional,
      }
    }

    const mapped = TYPE_MAP[cleanType]
    if (!mapped) {
      const validTypes = [...Object.keys(TYPE_MAP), 'enum:a,b,c'].join(', ')
      throw new Error(`Unknown field type: "${cleanType}". Valid types: ${validTypes}`)
    }

    return {
      name: namePart,
      type: cleanType,
      tsType: mapped.ts,
      zodType: mapped.zod,
      optional,
    }
  })
}

// ── Scaffold Generator ──────────────────────────────────────────────────

interface ScaffoldOptions {
  name: string
  fields: FieldDef[]
  modulesDir: string
  noEntity?: boolean
  noTests?: boolean
  repo?: 'inmemory'
  pluralize?: boolean
}

export async function generateScaffold(options: ScaffoldOptions): Promise<string[]> {
  const { name, fields, modulesDir, noEntity, noTests, repo = 'inmemory' } = options
  const shouldPluralize = options.pluralize !== false
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const camel = toCamelCase(name)
  const plural = shouldPluralize ? pluralize(kebab) : kebab
  const pluralPascal = shouldPluralize ? pluralizePascal(pascal) : pascal
  const moduleDir = join(modulesDir, plural)

  const files: string[] = []

  const write = async (relativePath: string, content: string) => {
    const fullPath = join(moduleDir, relativePath)
    await writeFileSafe(fullPath, content)
    files.push(fullPath)
  }

  // ── Module Index
  await write('index.ts', genModuleIndex(pascal, kebab, plural, repo))

  // ── Constants
  await write('constants.ts', genConstants(pascal, fields))

  // ── Controller
  await write(
    `presentation/${kebab}.controller.ts`,
    genController(pascal, kebab, plural, pluralPascal),
  )

  // ── DTOs
  await write(`application/dtos/create-${kebab}.dto.ts`, genCreateDTO(pascal, fields))
  await write(`application/dtos/update-${kebab}.dto.ts`, genUpdateDTO(pascal, fields))
  await write(`application/dtos/${kebab}-response.dto.ts`, genResponseDTO(pascal, fields))

  // ── Use Cases
  const useCases = genUseCases(pascal, kebab, plural, pluralPascal)
  for (const uc of useCases) {
    await write(`application/use-cases/${uc.file}`, uc.content)
  }

  // ── Domain: Repository Interface
  await write(`domain/repositories/${kebab}.repository.ts`, genRepositoryInterface(pascal, kebab))

  // ── Domain: Service
  await write(`domain/services/${kebab}-domain.service.ts`, genDomainService(pascal, kebab))

  // ── Infrastructure: Repository
  if (repo === 'inmemory') {
    await write(
      `infrastructure/repositories/in-memory-${kebab}.repository.ts`,
      genInMemoryRepository(pascal, kebab, fields),
    )
  }

  // ── Entity & Value Objects
  if (!noEntity) {
    await write(`domain/entities/${kebab}.entity.ts`, genEntity(pascal, kebab, fields))
    await write(`domain/value-objects/${kebab}-id.vo.ts`, genValueObject(pascal))
  }

  // ── Auto-register in modules index
  await autoRegisterModule(modulesDir, pascal, plural)

  return files
}

// ── Template Generators ─────────────────────────────────────────────────

function genCreateDTO(pascal: string, fields: FieldDef[]): string {
  const zodFields = fields
    .map((f) => {
      const base = f.zodType
      return `  ${f.name}: ${base}${f.optional ? '.optional()' : ''},`
    })
    .join('\n')

  return `import { z } from 'zod'

export const create${pascal}Schema = z.object({
${zodFields}
})

export type Create${pascal}DTO = z.infer<typeof create${pascal}Schema>
`
}

function genUpdateDTO(pascal: string, fields: FieldDef[]): string {
  const zodFields = fields.map((f) => `  ${f.name}: ${f.zodType}.optional(),`).join('\n')

  return `import { z } from 'zod'

export const update${pascal}Schema = z.object({
${zodFields}
})

export type Update${pascal}DTO = z.infer<typeof update${pascal}Schema>
`
}

function genResponseDTO(pascal: string, fields: FieldDef[]): string {
  const tsFields = fields.map((f) => `  ${f.name}${f.optional ? '?' : ''}: ${f.tsType}`).join('\n')

  return `export interface ${pascal}ResponseDTO {
  id: string
${tsFields}
  createdAt: string
  updatedAt: string
}
`
}

function genConstants(pascal: string, fields: FieldDef[]): string {
  const stringFields = fields.filter((f) => f.tsType === 'string').map((f) => `'${f.name}'`)
  const numberFields = fields.filter((f) => f.tsType === 'number').map((f) => `'${f.name}'`)
  const allFieldNames = fields.map((f) => `'${f.name}'`)

  const filterable = [...allFieldNames].join(', ')
  const sortable = [...allFieldNames, "'createdAt'", "'updatedAt'"].join(', ')
  const searchable = stringFields.length > 0 ? stringFields.join(', ') : "'name'"

  return `import type { ApiQueryParamsConfig } from '@forinda/kickjs'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: [${filterable}],
  sortable: [${sortable}],
  searchable: [${searchable}],
}
`
}

function genInMemoryRepository(pascal: string, kebab: string, fields: FieldDef[]): string {
  const fieldAssignments = fields.map((f) => `      ${f.name}: dto.${f.name},`).join('\n')
  const fieldSpread = '...dto'

  return `import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
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
${fieldAssignments}
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('${pascal} not found')
    const updated = { ...existing, ${fieldSpread}, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('${pascal} not found')
    this.store.delete(id)
  }
}
`
}

function genEntity(pascal: string, kebab: string, fields: FieldDef[]): string {
  const propsInterface = fields
    .map((f) => `  ${f.name}${f.optional ? '?' : ''}: ${f.tsType}`)
    .join('\n')
  const createParams = fields
    .filter((f) => !f.optional)
    .map((f) => `${f.name}: ${f.tsType}`)
    .join('; ')
  const createAssignments = fields
    .filter((f) => !f.optional)
    .map((f) => `      ${f.name}: params.${f.name},`)
    .join('\n')
  const getters = fields
    .map(
      (f) => `  get ${f.name}(): ${f.tsType}${f.optional ? ' | undefined' : ''} {
    return this.props.${f.name}
  }`,
    )
    .join('\n')
  const toJsonFields = fields.map((f) => `      ${f.name}: this.props.${f.name},`).join('\n')

  return `import { ${pascal}Id } from '../value-objects/${kebab}-id.vo'

interface ${pascal}Props {
  id: ${pascal}Id
${propsInterface}
  createdAt: Date
  updatedAt: Date
}

export class ${pascal} {
  private constructor(private props: ${pascal}Props) {}

  static create(params: { ${createParams} }): ${pascal} {
    const now = new Date()
    return new ${pascal}({
      id: ${pascal}Id.create(),
${createAssignments}
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: ${pascal}Props): ${pascal} {
    return new ${pascal}(props)
  }

  get id(): ${pascal}Id { return this.props.id }
${getters}
  get createdAt(): Date { return this.props.createdAt }
  get updatedAt(): Date { return this.props.updatedAt }

  toJSON() {
    return {
      id: this.props.id.toString(),
${toJsonFields}
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    }
  }
}
`
}

function genValueObject(pascal: string): string {
  return `import { randomUUID } from 'node:crypto'

export class ${pascal}Id {
  private constructor(private readonly value: string) {}

  static create(): ${pascal}Id { return new ${pascal}Id(randomUUID()) }

  static from(id: string): ${pascal}Id {
    if (!id || id.trim().length === 0) throw new Error('${pascal}Id cannot be empty')
    return new ${pascal}Id(id)
  }

  toString(): string { return this.value }
  equals(other: ${pascal}Id): boolean { return this.value === other.value }
}
`
}

// These reuse the same patterns as the existing module generator

function genModuleIndex(pascal: string, kebab: string, plural: string, repo: string): string {
  return `import type { AppModule, AppModuleClass } from '@forinda/kickjs'
import { ${pascal}Controller } from './presentation/${kebab}.controller'
import { ${pascal}DomainService } from './domain/services/${kebab}-domain.service'
import { ${pascal.toUpperCase()}_REPOSITORY } from './domain/repositories/${kebab}.repository'
import { InMemory${pascal}Repository } from './infrastructure/repositories/in-memory-${kebab}.repository'

export class ${pascal}Module implements AppModule {
  register(container: any): void {
    container.registerFactory(
      ${pascal.toUpperCase()}_REPOSITORY,
      () => container.resolve(InMemory${pascal}Repository),
    )
  }

  routes() {
    return { prefix: '/${plural}', controllers: [${pascal}Controller] }
  }
}
`
}

function genController(
  pascal: string,
  kebab: string,
  plural: string,
  pluralPascal: string,
): string {
  return `import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
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
`
}

function genRepositoryInterface(pascal: string, kebab: string): string {
  return `import type { ${pascal}ResponseDTO } from '../../application/dtos/${kebab}-response.dto'
import type { Create${pascal}DTO } from '../../application/dtos/create-${kebab}.dto'
import type { Update${pascal}DTO } from '../../application/dtos/update-${kebab}.dto'
import type { ParsedQuery } from '@forinda/kickjs'

export interface I${pascal}Repository {
  findById(id: string): Promise<${pascal}ResponseDTO | null>
  findAll(): Promise<${pascal}ResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }>
  create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO>
  update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO>
  delete(id: string): Promise<void>
}

export const ${pascal.toUpperCase()}_REPOSITORY = Symbol('I${pascal}Repository')
`
}

function genDomainService(pascal: string, kebab: string): string {
  return `import { Service, Inject, HttpException } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../repositories/${kebab}.repository'

@Service()
export class ${pascal}DomainService {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) throw HttpException.notFound('${pascal} not found')
  }
}
`
}

function genUseCases(
  pascal: string,
  kebab: string,
  plural: string,
  pluralPascal: string,
): Array<{ file: string; content: string }> {
  return [
    {
      file: `create-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { Create${pascal}DTO } from '../dtos/create-${kebab}.dto'

@Service()
export class Create${pascal}UseCase {
  constructor(@Inject(${pascal.toUpperCase()}_REPOSITORY) private repo: I${pascal}Repository) {}
  async execute(dto: Create${pascal}DTO) { return this.repo.create(dto) }
}
`,
    },
    {
      file: `get-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'

@Service()
export class Get${pascal}UseCase {
  constructor(@Inject(${pascal.toUpperCase()}_REPOSITORY) private repo: I${pascal}Repository) {}
  async execute(id: string) { return this.repo.findById(id) }
}
`,
    },
    {
      file: `list-${plural}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'

@Service()
export class List${pluralPascal}UseCase {
  constructor(@Inject(${pascal.toUpperCase()}_REPOSITORY) private repo: I${pascal}Repository) {}
  async execute(parsed: ParsedQuery) { return this.repo.findPaginated(parsed) }
}
`,
    },
    {
      file: `update-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { Update${pascal}DTO } from '../dtos/update-${kebab}.dto'

@Service()
export class Update${pascal}UseCase {
  constructor(@Inject(${pascal.toUpperCase()}_REPOSITORY) private repo: I${pascal}Repository) {}
  async execute(id: string, dto: Update${pascal}DTO) { return this.repo.update(id, dto) }
}
`,
    },
    {
      file: `delete-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'

@Service()
export class Delete${pascal}UseCase {
  constructor(@Inject(${pascal.toUpperCase()}_REPOSITORY) private repo: I${pascal}Repository) {}
  async execute(id: string) { return this.repo.delete(id) }
}
`,
    },
  ]
}

// ── Auto-register ───────────────────────────────────────────────────────

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
      `import type { AppModuleClass } from '@forinda/kickjs'\nimport { ${pascal}Module } from './${plural}'\n\nexport const modules: AppModuleClass[] = [${pascal}Module]\n`,
    )
    return
  }

  let content = await readFile(indexPath, 'utf-8')
  const importLine = `import { ${pascal}Module } from './${plural}'`

  if (!content.includes(`${pascal}Module`)) {
    const lastImportIdx = content.lastIndexOf('import ')
    if (lastImportIdx !== -1) {
      const lineEnd = content.indexOf('\n', lastImportIdx)
      content = content.slice(0, lineEnd + 1) + importLine + '\n' + content.slice(lineEnd + 1)
    } else {
      content = importLine + '\n' + content
    }

    content = content.replace(/(=\s*\[)([\s\S]*?)(])/, (_match, open, existing, close) => {
      const trimmed = existing.trim()
      if (!trimmed) return `${open}${pascal}Module${close}`
      const needsComma = trimmed.endsWith(',') ? '' : ','
      return `${open}${existing.trimEnd()}${needsComma} ${pascal}Module${close}`
    })
  }

  await writeFile(indexPath, content, 'utf-8')
}
