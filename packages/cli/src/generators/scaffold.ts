import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, pluralize, pluralizePascal } from '../utils/naming'
import { autoRegisterModule } from './module'
import {
  generateRestModuleIndex,
  generateRestController,
  generateRestConstants,
  generateRestService,
  generateRepositoryInterface,
  generateInMemoryRepository,
  generateCustomRepository,
} from './templates'

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
 * Mark optional fields — three equivalent syntaxes:
 *   body:text:optional  ← recommended (shell-safe, no quoting needed)
 *   body?:text          ← needs quoting in bash/zsh ("body?:text")
 *   body:text?          ← needs quoting in bash/zsh ("body:text?")
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
    let namePart = f.slice(0, colonIdx)
    let typePart = f.slice(colonIdx + 1)
    if (!namePart || !typePart) {
      throw new Error(`Invalid field: "${f}". Use format: name:type (e.g. title:string)`)
    }

    // Support three optional syntaxes:
    //   name:type:optional  ← shell-safe (recommended)
    //   name?:type          ← needs quoting in bash/zsh
    //   name:type?          ← needs quoting in bash/zsh
    let optional = false

    // Check for trailing :optional segment (but not enum:val1,val2)
    if (typePart.endsWith(':optional')) {
      typePart = typePart.slice(0, -':optional'.length)
      optional = true
    }

    // Check for ? on the name side: "body?:text"
    if (namePart.endsWith('?')) {
      namePart = namePart.slice(0, -1)
      optional = true
    }

    // Check for ? on the type side: "body:text?"
    if (typePart.endsWith('?')) {
      typePart = typePart.slice(0, -1)
      optional = true
    }

    const cleanType = typePart

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
  /**
   * DI-token scope prefix (e.g. `'mycorp'`, `'app'`). Substituted into
   * every emitted `createToken<T>('<scope>/<area>/<key>')`. Caller
   * resolves this from `kick.config.ts > tokenScope` or package.json
   * before invoking the scaffold; defaults to `'app'` here so existing
   * callers stay backward-compatible.
   */
  tokenScope?: string
  /**
   * Module declaration style — `'define'` (factory) or `'class'`
   * (legacy). Defaults to `'define'`. Resolved by the caller from
   * `kick.config.ts > modules.style`.
   */
  style?: 'define' | 'class'
}

export async function generateScaffold(options: ScaffoldOptions): Promise<string[]> {
  const {
    name,
    fields,
    modulesDir,
    repo = 'inmemory',
    tokenScope = 'app',
    style = 'define',
  } = options
  const shouldPluralize = options.pluralize !== false
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const plural = shouldPluralize ? pluralize(kebab) : kebab
  const pluralPascal = shouldPluralize ? pluralizePascal(pascal) : pascal
  const moduleDir = join(modulesDir, plural)

  const files: string[] = []

  const write = async (relativePath: string, content: string) => {
    const fullPath = join(moduleDir, relativePath)
    await writeFileSafe(fullPath, content)
    files.push(fullPath)
  }

  // Flat REST layout — identical structure to `kick g module` (the ddd/cqrs
  // layouts were removed), but the DTOs are generated from the supplied
  // `<field>:<type>` definitions instead of empty stubs. The boilerplate
  // (module/controller/service/repository) is shared with the REST pattern
  // so the field-aware DTOs slot in by their conventional export names.

  // Module file (named `<kebab>.module.ts` so Vite's discovery picks it up)
  await write(`${kebab}.module.ts`, generateRestModuleIndex({ pascal, kebab, plural, repo, style }))

  // Constants (query config)
  await write(`${kebab}.constants.ts`, generateRestConstants({ pascal, kebab }))

  // Controller + service (generic CRUD boilerplate)
  await write(
    `${kebab}.controller.ts`,
    generateRestController({ pascal, kebab, plural, pluralPascal }),
  )
  await write(`${kebab}.service.ts`, generateRestService({ pascal, kebab }))

  // Field-aware DTOs — the scaffold value-add
  await write(`dtos/create-${kebab}.dto.ts`, genCreateDTO(pascal, fields))
  await write(`dtos/update-${kebab}.dto.ts`, genUpdateDTO(pascal, fields))
  await write(`dtos/${kebab}-response.dto.ts`, genResponseDTO(pascal, fields))

  // Repository interface + implementation
  await write(
    `${kebab}.repository.ts`,
    generateRepositoryInterface({ pascal, kebab, dtoPrefix: './dtos', tokenScope }),
  )
  const isInMemory = repo === 'inmemory'
  const repoFile = isInMemory ? `in-memory-${kebab}` : `${toKebabCase(repo)}-${kebab}`
  const repoImpl = isInMemory
    ? generateInMemoryRepository({ pascal, kebab, repoPrefix: '.', dtoPrefix: './dtos' })
    : generateCustomRepository({
        pascal,
        kebab,
        repoType: repo,
        repoPrefix: '.',
        dtoPrefix: './dtos',
      })
  await write(`${repoFile}.repository.ts`, repoImpl)

  // Auto-register in modules index
  await autoRegisterModule(modulesDir, pascal, plural, kebab, style)

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
