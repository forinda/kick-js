import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'

/**
 * Direction the migrator rewrites in. Resolved by the caller from
 * `kick.config.ts > modules.style` (or an explicit `--target` flag),
 * so adopters can move either direction.
 */
export type MigrationTarget = 'define' | 'class'

export interface MigrationResult {
  migrated: string | null
  reason?: string
}

function findMatchingBrace(text: string, openIdx: number): number {
  if (text[openIdx] !== '{') return -1
  let depth = 1
  for (let i = openIdx + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function extractMethodBody(classBody: string, methodRegex: RegExp): string | null {
  const m = methodRegex.exec(classBody)
  if (!m) return null
  const openIdx = m.index + m[0].length - 1
  const closeIdx = findMatchingBrace(classBody, openIdx)
  if (closeIdx === -1) return null
  return classBody.slice(openIdx + 1, closeIdx)
}

function reindent(body: string, fromOuterIndent: number, toOuterIndent: number): string {
  const pad = ' '.repeat(toOuterIndent)
  return body
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line
      const stripPattern = new RegExp(`^ {0,${fromOuterIndent}}`)
      const stripped = line.replace(stripPattern, '')
      return pad + stripped
    })
    .join('\n')
}

function rewriteImportsForDefine(beforeBlock: string): string {
  return beforeBlock.replaceAll(
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*'@forinda\/kickjs'/g,
    (_match, names: string) => {
      const parts = names
        .split(',')
        .map((p) => p.trim())
        .filter(
          (p) =>
            p &&
            p !== 'Container' &&
            p !== 'type Container' &&
            p !== 'type AppModule' &&
            p !== 'AppModule' &&
            p !== 'type ModuleRoutes' &&
            p !== 'ModuleRoutes',
        )
      if (!parts.includes('defineModule')) parts.push('defineModule')
      return `import { ${parts.join(', ')} } from '@forinda/kickjs'`
    },
  )
}

function rewriteImportsForClass(
  beforeBlock: string,
  needs: {
    container: boolean
    appModule: boolean
    moduleRoutes: boolean
    contributorRegistrations: boolean
  },
): string {
  return beforeBlock.replaceAll(
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*'@forinda\/kickjs'/g,
    (_match, names: string) => {
      const parts = names
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p && p !== 'defineModule')
      if (needs.container && !parts.includes('Container')) parts.push('Container')
      if (needs.appModule && !parts.some((p) => p === 'AppModule' || p === 'type AppModule')) {
        parts.push('type AppModule')
      }
      if (
        needs.moduleRoutes &&
        !parts.some((p) => p === 'ModuleRoutes' || p === 'type ModuleRoutes')
      ) {
        parts.push('type ModuleRoutes')
      }
      if (
        needs.contributorRegistrations &&
        !parts.some(
          (p) => p === 'ContributorRegistrations' || p === 'type ContributorRegistrations',
        )
      ) {
        parts.push('type ContributorRegistrations')
      }
      return `import { ${parts.join(', ')} } from '@forinda/kickjs'`
    },
  )
}

export function migrateClassToDefine(content: string): MigrationResult {
  if (/\bdefineModule\s*\(/.test(content)) {
    return { migrated: null, reason: 'already in target form' }
  }

  const classRegex = /export\s+class\s+(\w+Module)\s+implements\s+AppModule\s*\{/g
  const matches = [...content.matchAll(classRegex)]

  if (matches.length === 0) {
    return { migrated: null, reason: 'no class form detected' }
  }
  if (matches.length > 1) {
    return {
      migrated: null,
      reason: 'multiple module classes in one file — migrate manually',
    }
  }

  const match = matches[0]
  const moduleName = match[1]
  const classOpenIdx = match.index + match[0].length - 1
  const classCloseIdx = findMatchingBrace(content, classOpenIdx)
  if (classCloseIdx === -1) {
    return { migrated: null, reason: 'unbalanced class braces' }
  }

  const classBody = content.slice(classOpenIdx + 1, classCloseIdx)
  const beforeClass = content.slice(0, match.index)
  const afterClass = content.slice(classCloseIdx + 1)

  const registerBody = extractMethodBody(classBody, /register\s*\(([^)]*)\)\s*:\s*void\s*\{/)
  const contributorsBody = extractMethodBody(
    classBody,
    /contributors\s*\(\s*\)\s*:\s*ContributorRegistrations\s*\{/,
  )
  const routesBody = extractMethodBody(classBody, /routes\s*\(\s*\)\s*:\s*[A-Za-z|[\]\s]+\{/)
  if (!routesBody) {
    return {
      migrated: null,
      reason: 'routes() method missing or signature unrecognized',
    }
  }

  const newImports = rewriteImportsForDefine(beforeClass)

  let buildBody = ''
  if (registerBody) {
    buildBody += `    register(container) {${reindent(registerBody, 4, 6)}    },\n\n`
  }
  if (contributorsBody) {
    buildBody += `    contributors() {${reindent(contributorsBody, 4, 6)}    },\n\n`
  }
  buildBody += `    routes() {${reindent(routesBody, 4, 6)}    },`

  const declaration = `export const ${moduleName} = defineModule({
  name: '${moduleName}',
  build: () => ({
${buildBody}
  }),
})`

  return { migrated: `${newImports}${declaration}${afterClass}` }
}

export function migrateDefineToClass(content: string): MigrationResult {
  if (/export\s+class\s+\w+Module\s+implements\s+AppModule\s*\{/.test(content)) {
    return { migrated: null, reason: 'already in target form' }
  }

  const declRegex = /export\s+const\s+(\w+Module)\s*=\s*defineModule\s*\(\s*\{/g
  const matches = [...content.matchAll(declRegex)]

  if (matches.length === 0) {
    return { migrated: null, reason: 'no defineModule form detected' }
  }
  if (matches.length > 1) {
    return {
      migrated: null,
      reason: 'multiple defineModule blocks in one file — migrate manually',
    }
  }

  const match = matches[0]
  const moduleName = match[1]
  const objOpenIdx = match.index + match[0].length - 1
  const objCloseIdx = findMatchingBrace(content, objOpenIdx)
  if (objCloseIdx === -1) {
    return { migrated: null, reason: 'unbalanced defineModule braces' }
  }

  const callCloseIdx = content.indexOf(')', objCloseIdx)
  if (callCloseIdx === -1) {
    return { migrated: null, reason: 'unbalanced defineModule call parens' }
  }

  const objBody = content.slice(objOpenIdx + 1, objCloseIdx)
  const beforeBlock = content.slice(0, match.index)
  let afterIdx = callCloseIdx + 1
  while (afterIdx < content.length && (content[afterIdx] === '\n' || content[afterIdx] === '\r')) {
    afterIdx++
  }
  const afterBlock = content.slice(afterIdx)

  const buildRegex = /build\s*:\s*\([^)]*\)\s*=>\s*\(\s*\{/g
  const buildMatch = buildRegex.exec(objBody)
  if (!buildMatch) {
    return { migrated: null, reason: 'build: () => ({...}) not found in defineModule' }
  }
  const buildOpenIdx = buildMatch.index + buildMatch[0].length - 1
  const buildCloseIdx = findMatchingBrace(objBody, buildOpenIdx)
  if (buildCloseIdx === -1) {
    return { migrated: null, reason: 'unbalanced build() braces' }
  }
  const buildBody = objBody.slice(buildOpenIdx + 1, buildCloseIdx)

  const registerBody = extractMethodBody(buildBody, /register\s*\(([^)]*)\)\s*\{/)
  const contributorsBody = extractMethodBody(buildBody, /contributors\s*\(\s*\)\s*\{/)
  const routesBody = extractMethodBody(buildBody, /routes\s*\(\s*\)\s*\{/)
  if (!routesBody) {
    return {
      migrated: null,
      reason: 'routes() method missing inside build()',
    }
  }

  const needs = {
    container: registerBody !== null,
    appModule: true,
    moduleRoutes: true,
    // contributors() in class form is typed as `ContributorRegistrations`,
    // so its import must follow when the source had a contributors block.
    contributorRegistrations: contributorsBody !== null,
  }
  const newImports = rewriteImportsForClass(beforeBlock, needs)

  let classBody = ''
  if (registerBody !== null) {
    classBody += `  register(container: Container): void {${reindent(registerBody, 6, 4)}  }\n\n`
  }
  if (contributorsBody !== null) {
    classBody += `  contributors(): ContributorRegistrations {${reindent(contributorsBody, 6, 4)}  }\n\n`
  }
  classBody += `  routes(): ModuleRoutes {${reindent(routesBody, 6, 4)}  }`

  const declaration = `export class ${moduleName} implements AppModule {
${classBody}
}
`

  return { migrated: `${newImports}${declaration}${afterBlock}` }
}

export function migrateModuleFile(content: string, target: MigrationTarget): MigrationResult {
  return target === 'class' ? migrateDefineToClass(content) : migrateClassToDefine(content)
}

export function migrateModulesIndex(content: string, target: MigrationTarget): MigrationResult {
  let next = content
  let changed = false

  if (target === 'define') {
    if (/\bAppModuleClass\b/.test(next)) {
      next = next.replaceAll(/\bAppModuleClass\b/g, 'AppModuleEntry')
      changed = true
    }
    // arrayRegex is intentionally single-match (no `/g`) — the
    // modules array appears once per file, so we replace the first
    // hit only and leave any non-array `[ … ]` literal alone.
    const arrayRegex = /(=\s*\[)([\s\S]*?)(])/
    const arrayMatch = arrayRegex.exec(next)
    if (arrayMatch) {
      const open = arrayMatch[1]
      const close = arrayMatch[3]
      const body = arrayMatch[2]
      const rewritten = body.replaceAll(/(\b\w+Module)(?![(.])/g, '$1()')
      if (rewritten !== body) {
        next = next.replace(arrayRegex, `${open}${rewritten}${close}`)
        changed = true
      }
    }
  } else {
    if (/\bAppModuleEntry\b/.test(next)) {
      next = next.replaceAll(/\bAppModuleEntry\b/g, 'AppModuleClass')
      changed = true
    }
    const arrayRegex = /(=\s*\[)([\s\S]*?)(])/
    const arrayMatch = arrayRegex.exec(next)
    if (arrayMatch) {
      const open = arrayMatch[1]
      const close = arrayMatch[3]
      const body = arrayMatch[2]
      const rewritten = body.replaceAll(/(\b\w+Module)\s*\(\s*\)/g, '$1')
      if (rewritten !== body) {
        next = next.replace(arrayRegex, `${open}${rewritten}${close}`)
        changed = true
      }
    }
  }

  return changed ? { migrated: next } : { migrated: null, reason: 'no changes needed' }
}

/**
 * Walk `modulesDir` recursively and collect every file that
 * declares a module. Two patterns are recognized:
 *
 *   - `<modulesDir>/<sub>/<name>.module.ts` — current convention,
 *     emitted by `kick g module`.
 *   - `<modulesDir>/<sub>/index.ts` — older convention; the module
 *     lives in `<sub>/index.ts` rather than a named file.
 *
 * `<modulesDir>/index.ts` itself is **excluded** because it's the
 * registry (`export const modules = [...]`), not a module
 * declaration. Same for `node_modules`, `dist`, and `.kickjs`
 * caches.
 */
export async function findModuleFiles(modulesDir: string): Promise<string[]> {
  const out: string[] = []
  const rootAbs = resolvePath(modulesDir)
  await walk(rootAbs, 0)
  return out

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name === '.kickjs') continue
      const full = join(dir, name)
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        await walk(full, depth + 1)
      } else if (name.endsWith('.module.ts')) {
        out.push(full)
      } else if (name === 'index.ts' && depth === 1) {
        // Older convention: module lives at
        // `<modulesDir>/<sub>/index.ts` (depth=1, the immediate
        // child directory's index file). Deeper `index.ts` files
        // (e.g. `<sub>/application/index.ts` or `<sub>/domain/index.ts`)
        // are barrel files for the DDD layout, NOT module
        // declarations — sweeping those in would false-positive
        // the drift gate and let the codemod rewrite unrelated code.
        // depth=0 is the registry at `<modulesDir>/index.ts`,
        // intentionally excluded.
        out.push(full)
      }
    }
  }
}

export interface MigrateRunResult {
  target: MigrationTarget
  files: Array<{ path: string; status: 'migrated' | 'skipped'; reason?: string }>
  indexStatus: 'migrated' | 'skipped' | 'not-found'
  indexPath: string
  indexReason?: string
  /**
   * Backup directory created before applying changes (when the
   * caller didn't pass `dryRun: true` or `backup: false`). Always
   * absolute; `null` when no backup was made (dry-run, no files to
   * migrate, or backup explicitly disabled).
   */
  backupDir: string | null
}

/**
 * Copy every file under `srcRoot` into `destRoot`, mirroring the
 * directory structure. Used to snapshot `modulesDir` before the
 * codemod rewrites in place — adopters who aren't tracking with
 * git can revert by replacing the modulesDir with the backup.
 *
 * Skips `node_modules`, `dist`, and `.kickjs` to keep backup size
 * sane. Symlinks are followed (we copy the resolved file), since
 * the only symlink we expect inside a project's modulesDir is the
 * test-fixture workspace link to `@forinda/kickjs` — not modules.
 */
async function copyDirectory(srcRoot: string, destRoot: string): Promise<number> {
  let count = 0
  await walk(srcRoot, destRoot)
  return count

  async function walk(src: string, dest: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(src)
    } catch {
      return
    }
    await mkdir(dest, { recursive: true })
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name === '.kickjs') continue
      const srcFull = join(src, name)
      const destFull = join(dest, name)
      let st
      try {
        st = await stat(srcFull)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        await walk(srcFull, destFull)
      } else {
        await copyFile(srcFull, destFull)
        count++
      }
    }
  }
}

/**
 * Build a timestamped backup directory under `<projectRoot>/.kickjs/codemod-backups/<isoStamp>-modules/`.
 * Returns the absolute path. Adopters revert by `rm -rf <modulesDir>; mv <backup> <modulesDir>`
 * (manual; the codemod doesn't provide a revert command yet).
 */
function makeBackupPath(projectRoot: string): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  return join(projectRoot, '.kickjs', 'codemod-backups', `${stamp}-modules`)
}

export interface MigrateModulesDirOptions {
  dryRun?: boolean
  cwd?: string
  target: MigrationTarget
  /**
   * Snapshot `modulesDir` to a timestamped backup folder before
   * rewriting. Defaults to `true` for `--apply` runs (catches
   * adopters not tracking with git); `false` for `dryRun: true`
   * (nothing is rewritten so a backup is moot).
   */
  backup?: boolean
}

export async function migrateModulesDir(
  modulesDir: string,
  options: MigrateModulesDirOptions,
): Promise<MigrateRunResult> {
  const { dryRun = false, cwd = process.cwd(), target } = options
  const shouldBackup = options.backup ?? !dryRun
  const moduleFiles = await findModuleFiles(modulesDir)
  const indexExists = await readFile(join(modulesDir, 'index.ts'), 'utf-8').then(
    () => true,
    () => false,
  )

  // Take the backup before any rewrite so a partial-migration
  // failure still leaves a recoverable snapshot. Snapshot when
  // EITHER module files OR the registry index exists — registry-only
  // rewrites (e.g. `[Module]` → `[Module()]` after every module file
  // is already migrated) still touch the project, so they deserve
  // the same safety net.
  let backupDir: string | null = null
  if (shouldBackup && (moduleFiles.length > 0 || indexExists)) {
    backupDir = makeBackupPath(cwd)
    await copyDirectory(modulesDir, backupDir)
  }

  const files: MigrateRunResult['files'] = []

  // Absolute paths in `files[].path` and `indexPath` so adopters can
  // cmd-click straight to the file from terminal output. The `cwd`
  // option is no longer needed here but stays in the option type for
  // backwards-compatibility with callers that pass it.
  for (const path of moduleFiles) {
    const content = await readFile(path, 'utf-8')
    const result = migrateModuleFile(content, target)
    if (result.migrated == null) {
      files.push({ path, status: 'skipped', reason: result.reason })
      continue
    }
    if (!dryRun) {
      await writeFile(path, result.migrated, 'utf-8')
    }
    files.push({ path, status: 'migrated' })
  }

  const indexPath = join(modulesDir, 'index.ts')
  let indexContent: string | null = null
  try {
    indexContent = await readFile(indexPath, 'utf-8')
  } catch {
    return {
      target,
      files,
      indexStatus: 'not-found',
      indexPath,
      backupDir,
    }
  }

  const indexResult = migrateModulesIndex(indexContent, target)
  if (indexResult.migrated == null) {
    return {
      target,
      files,
      indexStatus: 'skipped',
      indexPath,
      indexReason: indexResult.reason,
      backupDir,
    }
  }
  if (!dryRun) {
    await writeFile(indexPath, indexResult.migrated, 'utf-8')
  }
  return {
    target,
    files,
    indexStatus: 'migrated',
    indexPath,
    backupDir,
  }
}

/**
 * Quick scan for the `kick g module` gate: returns the list of
 * module-declaration files under `modulesDir` whose shape doesn't
 * match `expectedStyle`.
 *
 * Inspects both `*.module.ts` files AND legacy `<sub>/index.ts`
 * files via {@link findModuleFiles}.
 */
export async function findStyleDriftModules(
  modulesDir: string,
  expectedStyle: MigrationTarget,
): Promise<string[]> {
  const moduleFiles = await findModuleFiles(modulesDir)
  const drift: string[] = []
  const driftPattern =
    expectedStyle === 'define'
      ? /export\s+class\s+\w+Module\s+implements\s+AppModule\s*\{/
      : /export\s+const\s+\w+Module\s*=\s*defineModule\s*\(/
  for (const path of moduleFiles) {
    const content = await readFile(path, 'utf-8')
    if (driftPattern.test(content)) drift.push(path)
  }
  return drift
}

// `dirname` and `sep` re-exported so tests / future helpers can
// reuse them via the same import surface.
export { dirname, sep } from 'node:path'
