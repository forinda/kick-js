import { join } from 'node:path'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { toPascalCase, toKebabCase, pluralize } from '../utils/naming'
import { confirm } from '../utils/prompts'
import { colors } from '../utils/colors'
import { fileExists } from '../utils/fs'
import { escapeRegex } from '../utils/regex'
import { findModulesRhsSpan } from './module'

/**
 * Strip every `.mount(<X>Module(...))` call from a `defineModules()`
 * chain whose first arg names `<pascal>Module`. Walks balanced parens
 * so adopter-customised arg shapes (`.mount(X.scoped('foo'))`,
 * `.mount(X({ ... }))`) don't break removal — the `.mount(` boundary
 * is matched on the outer paren only.
 *
 * Returns the rewritten content + a flag indicating whether anything
 * was stripped (caller surfaces an "unregistered" message only when
 * the chain actually changed).
 */
function stripChainMount(content: string, pascal: string): { content: string; changed: boolean } {
  const moduleNameRe = new RegExp(`^\\s*${escapeRegex(pascal)}Module\\b`)
  let changed = false
  let cursor = 0
  let out = content

  while (true) {
    // Find the next `.mount(` boundary.
    const mountIdx = out.indexOf('.mount(', cursor)
    if (mountIdx === -1) break
    const argStart = mountIdx + '.mount('.length

    // Walk balanced parens to find the closing `)` of this call.
    // Skip string literals + `//` / `/* *\/` comments so a `)` in
    // either doesn't terminate the scan early.
    let depth = 1
    let i = argStart
    while (i < out.length && depth > 0) {
      const next = out.slice(i, i + 2)
      if (next === '//' || next === '/*') {
        if (next === '//') {
          i += 2
          while (i < out.length && out[i] !== '\n') i++
        } else {
          i += 2
          while (i + 1 < out.length && !(out[i] === '*' && out[i + 1] === '/')) i++
          i += 2
        }
        continue
      }
      const ch = out[i] ?? ''
      if (ch === "'" || ch === '"' || ch === '`') {
        // Skip string literal — find matching unescaped quote.
        const quote = ch
        i++
        while (i < out.length && out[i] !== quote) {
          if (out[i] === '\\') i++
          i++
        }
      } else if (ch === '(') {
        depth++
      } else if (ch === ')') {
        depth--
        if (depth === 0) break
      }
      i++
    }
    if (depth !== 0) break // unbalanced — bail

    const argText = out.slice(argStart, i)
    if (moduleNameRe.test(argText)) {
      // Strip the entire `.mount(...)` call. Also peel back any
      // leading whitespace + newline so the chain stays clean
      // (otherwise we'd leave a blank `\n  ` behind from the
      // generated multi-line `.mount(...)` form).
      let strippedStart = mountIdx
      while (
        strippedStart > 0 &&
        (out[strippedStart - 1] === ' ' ||
          out[strippedStart - 1] === '\t' ||
          out[strippedStart - 1] === '\n')
      ) {
        strippedStart--
      }
      out = out.slice(0, strippedStart) + out.slice(i + 1)
      changed = true
      cursor = strippedStart
      continue
    }
    cursor = i + 1
  }

  return { content: out, changed }
}

/**
 * Apply both unregistration strategies (chain `.mount(...)` strip +
 * flat-array entry strip) to the actual `export const modules`
 * initializer slice only. Anything outside that slice — helper
 * arrays, comments, sibling builders, even a doc string with an
 * embedded `.mount(UserModule())` example — is left untouched.
 *
 * Returns the rewritten file content. When no `export const
 * modules` declaration is found, returns the original unchanged
 * (the caller has already removed the import line).
 */
function stripFromModulesRhs(content: string, pascal: string): string {
  const span = findModulesRhsSpan(content)
  if (!span) return content

  // Slice covers `[...]` for arrays or `defineModules()...` for chains.
  // For chains, `chainEnd` points just past the last `.mount(...)`'s
  // closing `)`; we want to mutate up to but not including that
  // boundary. `rhsEnd + 1` aligns with both shapes.
  const sliceStart = span.rhsStart
  const sliceEnd = span.rhsEnd + 1
  let slice = content.slice(sliceStart, sliceEnd)

  // 1. Strip `.mount(<X>Module(...))` calls from the chain. Operates
  //    only on the slice so `.mount(...)` references elsewhere in
  //    the file aren't candidates.
  slice = stripChainMount(slice, pascal).content

  // 2. Strip the flat-array entry — `\b` after `Module` so
  //    `UserModule` doesn't match inside `UserModuleFactory`.
  slice = slice.replace(
    new RegExp(`\\s*,?\\s*${escapeRegex(pascal)}Module\\b(?:\\s*\\(\\s*\\))?\\s*,?`, 'g'),
    (match) => {
      const startsWithComma = match.trimStart().startsWith(',')
      const endsWithComma = match.trimEnd().endsWith(',')
      if (startsWithComma && endsWithComma) return ','
      return ''
    },
  )

  // 3. Clean up a dangling comma before `]` (only relevant when the
  //    slice is an array literal).
  slice = slice.replace(/,(\s*])/, '$1')

  return content.slice(0, sliceStart) + slice + content.slice(sliceEnd)
}

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
      `^import\\s*\\{\\s*${escapeRegex(pascal)}Module\\s*\\}\\s*from\\s*['"][^'"]*${escapeRegex(plural)}(?:/[^'"]*)?['"].*\\n?`,
      'gm',
    )
    content = content.replace(importPattern, '')

    // Anchor both removals on the actual `export const modules`
    // initializer slice — running them on the whole file would let a
    // helper array, comment, or stray `.mount(...)` reference
    // elsewhere take the hit instead of the real registry.
    content = stripFromModulesRhs(content, pascal)

    // Clean up double blank lines (the import-line removal can leave
    // these behind regardless of which rhs shape was edited).
    content = content.replace(/\n{3,}/g, '\n\n')

    if (content !== originalContent) {
      await writeFile(indexPath, content, 'utf-8')
      console.log(`  Unregistered: ${pascal}Module from ${indexPath}`)
    }
  }

  console.log(`\n  Module '${plural}' removed.\n`)
}
