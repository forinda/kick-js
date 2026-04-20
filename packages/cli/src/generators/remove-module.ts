import { join } from 'node:path'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { toPascalCase, toKebabCase, pluralize } from '../utils/naming'
import { confirm } from '../utils/prompts'
import { colors } from '../utils/colors'
import { fileExists } from '../utils/fs'

interface RemoveModuleOptions {
  name: string
  modulesDir: string
  force?: boolean
  pluralize?: boolean
}

/**
 * Remove a module — deletes its directory and unregisters it from the modules index.
 */
export async function removeModule(options: RemoveModuleOptions): Promise<void> {
  const { name, modulesDir, force } = options
  const shouldPluralize = options.pluralize !== false

  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const plural = shouldPluralize ? pluralize(kebab) : kebab
  const moduleDir = join(modulesDir, plural)

  // Check if module exists
  if (!(await fileExists(moduleDir))) {
    console.log(`\n  Module not found: ${moduleDir}\n`)
    return
  }

  // Confirm deletion unless --force
  if (!force) {
    const confirmed = await confirm({
      message: colors.red(`Delete module '${plural}' at ${moduleDir}? This cannot be undone.`),
      initialValue: false,
    })
    if (!confirmed) {
      console.log('\n  Cancelled.\n')
      return
    }
  }

  // 1. Remove the module directory
  await rm(moduleDir, { recursive: true, force: true })
  console.log(`  Deleted: ${moduleDir}`)

  // 2. Unregister from modules/index.ts
  const indexPath = join(modulesDir, 'index.ts')
  if (await fileExists(indexPath)) {
    let content = await readFile(indexPath, 'utf-8')
    const originalContent = content

    // Remove import line — matches both legacy `'./<plural>'` and current `'./<plural>/<kebab>.module'`
    const importPattern = new RegExp(
      `^import\\s*\\{\\s*${pascal}Module\\s*\\}\\s*from\\s*['"][^'"]*${plural}(?:/[^'"]*)?['"].*\\n?`,
      'gm',
    )
    content = content.replace(importPattern, '')

    // Remove from modules array — handle: ModuleName, or ModuleName (last entry)
    content = content.replace(new RegExp(`\\s*,?\\s*${pascal}Module\\s*,?`, 'g'), (match) => {
      // If match starts and ends with comma, keep one comma
      const startsWithComma = match.trimStart().startsWith(',')
      const endsWithComma = match.trimEnd().endsWith(',')
      if (startsWithComma && endsWithComma) return ','
      return ''
    })

    // Clean up dangling commas before ]
    content = content.replace(/,(\s*])/, '$1')

    // Clean up double blank lines
    content = content.replace(/\n{3,}/g, '\n\n')

    if (content !== originalContent) {
      await writeFile(indexPath, content, 'utf-8')
      console.log(`  Unregistered: ${pascal}Module from ${indexPath}`)
    }
  }

  console.log(`\n  Module '${plural}' removed.\n`)
}
