import { join } from 'node:path'
import { writeFileSafe, fileExists } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase, pluralize, pluralizePascal } from '../utils/naming'
import { readFile, writeFile } from 'node:fs/promises'
import {
  generateModuleIndex,
  generateController,
  generateConstants,
  generateCreateDTO,
  generateUpdateDTO,
  generateResponseDTO,
  generateUseCases,
  generateRepositoryInterface,
  generateInMemoryRepository,
  generateDomainService,
  generateEntity,
  generateValueObject,
  generateControllerTest,
  generateRepositoryTest,
} from './templates'

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
  await write('index.ts', generateModuleIndex(pascal, kebab, plural, repo))

  // ── Constants ──────────────────────────────────────────────────────
  await write('constants.ts', generateConstants(pascal))

  // ── Controller ──────────────────────────────────────────────────────
  await write(
    `presentation/${kebab}.controller.ts`,
    generateController(pascal, kebab, plural, pluralPascal),
  )

  // ── DTOs ────────────────────────────────────────────────────────────
  await write(`application/dtos/create-${kebab}.dto.ts`, generateCreateDTO(pascal, kebab))
  await write(`application/dtos/update-${kebab}.dto.ts`, generateUpdateDTO(pascal, kebab))
  await write(`application/dtos/${kebab}-response.dto.ts`, generateResponseDTO(pascal, kebab))

  // ── Use Cases ───────────────────────────────────────────────────────
  const useCases = generateUseCases(pascal, kebab, plural, pluralPascal)
  for (const uc of useCases) {
    await write(`application/use-cases/${uc.file}`, uc.content)
  }

  // ── Domain: Repository Interface ────────────────────────────────────
  await write(
    `domain/repositories/${kebab}.repository.ts`,
    generateRepositoryInterface(pascal, kebab),
  )

  // ── Domain: Service ─────────────────────────────────────────────────
  await write(`domain/services/${kebab}-domain.service.ts`, generateDomainService(pascal, kebab))

  // ── Infrastructure: Repository Implementation ──────────────────────
  if (repo === 'inmemory') {
    await write(
      `infrastructure/repositories/in-memory-${kebab}.repository.ts`,
      generateInMemoryRepository(pascal, kebab),
    )
  }

  // ── Entity & Value Objects ──────────────────────────────────────────
  if (!noEntity && !minimal) {
    await write(`domain/entities/${kebab}.entity.ts`, generateEntity(pascal, kebab))
    await write(`domain/value-objects/${kebab}-id.vo.ts`, generateValueObject(pascal, kebab))
  }

  // ── Tests ──────────────────────────────────────────────────────────
  if (!noTests) {
    await write(
      `__tests__/${kebab}.controller.test.ts`,
      generateControllerTest(pascal, kebab, plural),
    )
    await write(
      `__tests__/${kebab}.repository.test.ts`,
      generateRepositoryTest(pascal, kebab, plural),
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
