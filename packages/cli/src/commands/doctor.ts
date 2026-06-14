import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { Command } from 'commander'
import { loadKickConfig, type KickConfig } from '../config'
import { resolveAppRuntime, UPLOAD_DRIVERS, type AppRuntime } from './add'
import { colors } from '../utils/colors'
import { intro, outro, log } from '../utils/prompts'

/**
 * `kick doctor` — pre-flight checks for a KickJS project's dev
 * environment. Detects common misconfigs before they bite, with an
 * actionable fix hint for each problem.
 *
 * Sibling command to `kick check --deploy`, which scans for production
 * readiness (JWT, CORS, helmet, etc.). Doctor is the dev-setup
 * counterpart — "is my environment correctly wired?"
 *
 * Extending: adopters can ship their own checks by exporting a
 * `doctor.checks` array from `kick.config.ts`. Each {@link DoctorCheck}
 * receives the same {@link DoctorContext} the built-ins use and
 * returns one or more {@link DoctorResult}s. The framework stays
 * ORM-agnostic — Prisma / Drizzle / Mongoose-specific checks belong
 * in their respective adapters or in adopter config, not in core.
 */

// ── Public types ──────────────────────────────────────────────────────

export interface DoctorContext {
  cwd: string
  pkg: any | null
  tsconfig: any | null
  /**
   * The project's HTTP runtime — from kick.config `runtime`, else sniffed from
   * deps, else `express`. Lets engine-aware checks (engine peers, the upload
   * multipart driver) validate against the right backend.
   */
  runtime: AppRuntime
}

export interface DoctorResult {
  /** Short label for the check (printed first). */
  name: string
  status: 'pass' | 'warn' | 'fail'
  /** Optional extra context after the label (e.g. resolved version). */
  message?: string
  /** Multi-line actionable fix shown when status is `warn` or `fail`. */
  fix?: string
}

export type DoctorCheck = (
  ctx: DoctorContext,
) => DoctorResult | DoctorResult[] | null | Promise<DoctorResult | DoctorResult[] | null>

/**
 * Shape of a doctor extension — the `doctor` block on `KickConfig`,
 * also the publishable unit that plugins and shared modules use to
 * ship a bundle of related checks.
 */
export interface DoctorExtension {
  /** Extra checks merged after the built-ins. */
  checks?: DoctorCheck[]
}

/**
 * Identity helper for adopters / plugins authoring a doctor extension.
 *
 * Provides type inference + autocomplete on the `checks` array without
 * requiring an explicit `: DoctorExtension` annotation. Mirrors the
 * `defineConfig` pattern.
 *
 * @example
 * ```ts
 * // doctor-checks/prisma.ts (shared across projects, or shipped as a
 * // standalone package)
 * import { defineDoctorExtension } from '@forinda/kickjs-cli'
 * import { existsSync } from 'node:fs'
 * import { join } from 'node:path'
 *
 * export const prismaDoctor = defineDoctorExtension({
 *   checks: [
 *     (ctx) => {
 *       if (!existsSync(join(ctx.cwd, 'prisma/schema.prisma'))) return null
 *       const generated = join(ctx.cwd, 'node_modules/@prisma/client/default.js')
 *       return existsSync(generated)
 *         ? { name: 'Prisma client generated', status: 'pass' }
 *         : { name: 'Prisma client generated', status: 'fail', fix: 'pnpm exec prisma generate' }
 *     },
 *   ],
 * })
 *
 * // kick.config.ts
 * import { defineConfig } from '@forinda/kickjs-cli'
 * import { prismaDoctor } from './doctor-checks/prisma'
 *
 * export default defineConfig({ doctor: prismaDoctor })
 * ```
 */
export function defineDoctorExtension(ext: DoctorExtension): DoctorExtension {
  return ext
}

/**
 * Identity helper for a single doctor check. Pairs with
 * `defineDoctorExtension` when assembling an extension from separate
 * per-check files, and gives the same type-inference win for one-offs.
 *
 * @example
 * ```ts
 * import { defineDoctorCheck } from '@forinda/kickjs-cli'
 *
 * export const checkJwtSecretLength = defineDoctorCheck((ctx) => {
 *   const v = process.env.JWT_SECRET
 *   if (!v || v.length < 32) {
 *     return {
 *       name: 'JWT_SECRET ≥ 32 chars',
 *       status: 'warn',
 *       fix: 'Generate a strong secret: openssl rand -hex 32',
 *     }
 *   }
 *   return { name: 'JWT_SECRET ≥ 32 chars', status: 'pass' }
 * })
 * ```
 */
export function defineDoctorCheck(check: DoctorCheck): DoctorCheck {
  return check
}

// ── File helpers ──────────────────────────────────────────────────────

function safeReadJson(filepath: string): any | null {
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8'))
  } catch {
    return null
  }
}

function safeRead(filepath: string): string | null {
  try {
    return readFileSync(filepath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Read tsconfig.json with `extends` followed one level. Most adopters
 * use a single config; for those that extend kickjs-cli's preset, we
 * pick up the inherited `compilerOptions`. Avoids pulling in `tsc` just
 * to resolve the chain.
 */
function loadTsConfig(cwd: string): any | null {
  const tsconfigPath = join(cwd, 'tsconfig.json')
  const raw = safeRead(tsconfigPath)
  if (!raw) return null
  // tsconfig files often contain comments; strip them before parsing.
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  let cfg: any
  try {
    cfg = JSON.parse(stripped)
  } catch {
    return null
  }
  if (typeof cfg?.extends === 'string') {
    const extendsPath = resolveExtends(cwd, cfg.extends)
    if (extendsPath) {
      const parent = safeReadJson(extendsPath) ?? {}
      cfg.compilerOptions = {
        ...parent.compilerOptions,
        ...cfg.compilerOptions,
      }
    }
  }
  return cfg
}

function resolveExtends(cwd: string, ext: string): string | null {
  if (ext.startsWith('.')) {
    const resolved = resolve(cwd, ext)
    return existsSync(resolved) ? resolved : null
  }
  const mod = join(cwd, 'node_modules', ext)
  if (existsSync(mod)) return mod
  return null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Individual checks ─────────────────────────────────────────────────

const MIN_NODE_MAJOR = 20

export function checkNodeVersion(): DoctorResult {
  const v = process.version
  const major = Number.parseInt(v.replace(/^v/, '').split('.')[0]!, 10)
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return {
      name: 'Node version',
      status: 'fail',
      message: v,
      fix: `KickJS requires Node ${MIN_NODE_MAJOR} or newer.\nInstall a supported version via nvm / fnm / volta.`,
    }
  }
  return { name: 'Node version', status: 'pass', message: v }
}

export function checkKickJsInstalled(ctx: DoctorContext): DoctorResult {
  if (!ctx.pkg) {
    return { name: '@forinda/kickjs installed', status: 'warn', message: 'no package.json' }
  }
  const deps = {
    ...ctx.pkg.dependencies,
    ...ctx.pkg.peerDependencies,
  }
  if (!deps['@forinda/kickjs']) {
    return {
      name: '@forinda/kickjs installed',
      status: 'fail',
      fix: 'This directory does not look like a KickJS project — `@forinda/kickjs` is not in your package.json. Run `kick doctor` from the project root, or scaffold a fresh project with `kick new <name>`.',
    }
  }
  return { name: '@forinda/kickjs installed', status: 'pass', message: deps['@forinda/kickjs'] }
}

export function checkExpressInstalled(ctx: DoctorContext): DoctorResult | null {
  if (!ctx.pkg) return null
  const deps = {
    ...ctx.pkg.dependencies,
    ...ctx.pkg.peerDependencies,
  }
  if (deps['@forinda/kickjs'] && !deps.express) {
    return {
      name: 'express installed',
      status: 'fail',
      fix: '`@forinda/kickjs` declares `express` as a required peer dependency, but your package.json does not include it. Install: pnpm add express',
    }
  }
  return deps.express ? { name: 'express installed', status: 'pass', message: deps.express } : null
}

/** Engine peers required by the configured non-Express runtime. */
const RUNTIME_PEERS: Record<AppRuntime, string[]> = {
  express: [], // covered by checkExpressInstalled
  fastify: ['fastify', '@fastify/middie'],
  h3: ['h3'],
}

/**
 * The configured runtime's engine peers are installed. Express is checked by
 * {@link checkExpressInstalled}; this covers the Fastify / h3 runtimes, whose
 * peers are optional on `@forinda/kickjs` and so only required when chosen.
 */
export function checkRuntimeEngine(ctx: DoctorContext): DoctorResult | null {
  if (!ctx.pkg || ctx.runtime === 'express') return null
  const deps = {
    ...ctx.pkg.dependencies,
    ...ctx.pkg.peerDependencies,
    ...ctx.pkg.devDependencies,
  }
  const missing = RUNTIME_PEERS[ctx.runtime].filter((p) => !deps[p])
  const name = `runtime engine (${ctx.runtime})`
  if (missing.length > 0) {
    return {
      name,
      status: 'fail',
      fix: `Resolved runtime '${ctx.runtime}' is missing engine peer(s): ${missing.join(', ')}.\nInstall: pnpm add ${missing.join(' ')}`,
    }
  }
  return { name, status: 'pass' }
}

/**
 * When the project actually uses file uploads (`@FileUpload` / the `upload`
 * middleware), the multipart driver for its runtime must be installed —
 * express → multer, fastify → @fastify/multipart, h3 → built-in (nothing).
 * Skips silently when no upload usage is detected, so non-upload apps aren't
 * nagged about a driver they don't need.
 */
export function checkUploadDriver(ctx: DoctorContext): DoctorResult | null {
  if (!ctx.pkg || !srcUsesUpload(ctx.cwd)) return null
  const driver = UPLOAD_DRIVERS[ctx.runtime]
  const name = `upload driver (${ctx.runtime})`
  // h3 parses multipart natively — there is no driver to require.
  if (!driver.prod) return { name, status: 'pass', message: 'native multipart' }
  const deps = {
    ...ctx.pkg.dependencies,
    ...ctx.pkg.peerDependencies,
    ...ctx.pkg.devDependencies,
  }
  if (!deps[driver.prod]) {
    return {
      name,
      status: 'fail',
      fix: `This project uses file uploads on the '${ctx.runtime}' runtime, which needs '${driver.prod}'.\nInstall it: kick add upload (or pnpm add ${driver.prod})`,
    }
  }
  return { name, status: 'pass', message: driver.prod }
}

const MAX_UPLOAD_SCAN_FILES = 2000

/** Bounded walk of src/ looking for @FileUpload / upload.single|array|none usage. */
function srcUsesUpload(cwd: string): boolean {
  const srcDir = join(cwd, 'src')
  if (!existsSync(srcDir)) return false
  const pattern = /@FileUpload\b|\bupload\.(single|array|none)\s*\(/
  const stack = [srcDir]
  let visited = 0
  while (stack.length > 0 && visited < MAX_UPLOAD_SCAN_FILES) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (visited >= MAX_UPLOAD_SCAN_FILES) break
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') stack.push(full)
        continue
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue
      visited++
      if (pattern.test(safeRead(full) ?? '')) return true
    }
  }
  return false
}

export function checkReflectMetadata(ctx: DoctorContext): DoctorResult {
  if (!ctx.pkg)
    return { name: 'reflect-metadata installed', status: 'warn', message: 'no package.json' }
  const deps = {
    ...ctx.pkg.dependencies,
    ...ctx.pkg.peerDependencies,
    ...ctx.pkg.devDependencies,
  }
  if (!deps['reflect-metadata']) {
    return {
      name: 'reflect-metadata installed',
      status: 'fail',
      fix: `KickJS decorators require the reflect-metadata polyfill.\nInstall it: pnpm add reflect-metadata\nThen import it at the top of src/index.ts:\n\n  import 'reflect-metadata'\n  // ... rest of bootstrap`,
    }
  }
  return { name: 'reflect-metadata installed', status: 'pass', message: deps['reflect-metadata'] }
}

export function checkDecoratorTsConfig(ctx: DoctorContext): DoctorResult[] {
  if (!ctx.tsconfig) {
    return [
      {
        name: 'tsconfig.json present',
        status: 'fail',
        fix: 'Create a tsconfig.json with `experimentalDecorators: true` and `emitDecoratorMetadata: true`. `kick new` scaffolds one automatically.',
      },
    ]
  }
  const co = ctx.tsconfig.compilerOptions ?? {}
  const results: DoctorResult[] = []
  results.push(
    co.experimentalDecorators === true
      ? { name: 'tsconfig: experimentalDecorators', status: 'pass' }
      : {
          name: 'tsconfig: experimentalDecorators',
          status: 'fail',
          fix: 'Add `"experimentalDecorators": true` to compilerOptions in tsconfig.json. Without it, @Service / @Controller / @Get etc. don\'t register any metadata at compile time.',
        },
  )
  results.push(
    co.emitDecoratorMetadata === true
      ? { name: 'tsconfig: emitDecoratorMetadata', status: 'pass' }
      : {
          name: 'tsconfig: emitDecoratorMetadata',
          status: 'fail',
          fix: 'Add `"emitDecoratorMetadata": true` to compilerOptions in tsconfig.json. The DI container uses this metadata for constructor-parameter injection.',
        },
  )
  return results
}

/**
 * The canonical "you forgot to wire env" footgun: an env-init file
 * (e.g. `src/env.ts`, `src/config/env.ts`, `src/config/index.ts`)
 * calls `loadEnv(envSchema)` as a side effect, but the app entry
 * (`src/index.ts` / `src/main.ts`) doesn't import it. Result:
 * `ConfigService.get('X')` returns undefined while `@Value('X')`
 * works via process.env fallback, so adopters get half-broken config
 * without seeing an error.
 *
 * Detection walks the common env-file locations, identifies the ones
 * that actually call `loadEnv(`, then verifies the app entry imports
 * one of them (via relative path or `@/` alias) BEFORE `bootstrap(`.
 */
export function checkEnvWiring(ctx: DoctorContext): DoctorResult | null {
  const envCandidates = [
    'src/env.ts',
    'src/env/index.ts',
    'src/config/env.ts',
    'src/config/index.ts',
  ]
  const envFiles = envCandidates
    .map((p) => join(ctx.cwd, p))
    .filter((p) => existsSync(p))
    .filter((p) => /\bloadEnv\s*\(/.test(safeRead(p) ?? ''))

  if (envFiles.length === 0) return null

  const indexPath = ['src/index.ts', 'src/main.ts']
    .map((p) => join(ctx.cwd, p))
    .find((p) => existsSync(p))
  if (!indexPath) {
    return {
      name: 'env wiring',
      status: 'warn',
      message: 'env-init file exists but no src/index.ts or src/main.ts found',
    }
  }
  const indexContent = safeRead(indexPath) ?? ''
  const indexDir = dirname(indexPath)

  // Build the set of import specifiers that would wire any of these
  // env files — relative paths (`./env`, `./config/env`, …) and the
  // `@/` alias variant (`@/env`, `@/config/env`, …). For each file we
  // accept both the with-`/index` suffix and the bare-directory form,
  // since both resolve to the same module under TypeScript.
  const importSpecs: string[] = []
  for (const envFile of envFiles) {
    const relPath = relative(indexDir, envFile).replace(/\\/g, '/').replace(/\.ts$/, '')
    const relImport = relPath.startsWith('.') ? relPath : './' + relPath
    const relImportNoIndex = relImport.replace(/\/index$/, '')
    importSpecs.push(relImport, relImportNoIndex)

    // `@/` is the standard alias the scaffold and most adopters use;
    // it points at `src/`. Derive the @/-prefixed path from the file's
    // location under src/.
    const srcRel = envFile.replace(/\\/g, '/').match(/\/src\/(.+?)(?:\.ts)?$/)
    if (srcRel) {
      const aliasImport = '@/' + srcRel[1]
      const aliasNoIndex = aliasImport.replace(/\/index$/, '')
      importSpecs.push(aliasImport, aliasNoIndex)
    }
  }

  let earliestImportIdx = -1
  for (const spec of new Set(importSpecs)) {
    const re = new RegExp(`^import\\s+(?:.*?from\\s+)?['"]${escapeRegExp(spec)}['"]`, 'm')
    const m = indexContent.match(re)
    if (m && m.index !== undefined) {
      if (earliestImportIdx === -1 || m.index < earliestImportIdx) {
        earliestImportIdx = m.index
      }
    }
  }

  const bootstrapIdx = indexContent.search(/\bbootstrap\s*\(/)
  const sample = envFiles.map((p) => relative(ctx.cwd, p).replace(/\\/g, '/')).join(', ')

  if (earliestImportIdx === -1) {
    return {
      name: 'env wiring',
      status: 'fail',
      message: sample,
      fix: `An env-init file (${sample}) calls \`loadEnv(...)\` but \`${relative(ctx.cwd, indexPath).replace(/\\/g, '/')}\` doesn't import it.\nWithout this, ConfigService.get('X') returns undefined while @Value('X') works via process.env fallback — a half-broken config you won't notice until something is missing.\n\nFix: add a side-effect import at the top of ${relative(ctx.cwd, indexPath).replace(/\\/g, '/')} (above bootstrap()), pointing at one of the detected files. For example:\n\n  import './env'\n  // or\n  import './config'\n  // or, with the @/ alias:\n  import '@/config/env'`,
    }
  }
  if (bootstrapIdx !== -1 && earliestImportIdx > bootstrapIdx) {
    return {
      name: 'env wiring',
      status: 'warn',
      message: 'env-init imported AFTER bootstrap() — should be before',
      fix: `Move the env import above the bootstrap() call so the schema runs before any service reads from ConfigService.`,
    }
  }
  return { name: 'env wiring', status: 'pass' }
}

/**
 * Find the newest file mtime under a directory tree, recursively.
 * Returns `0` when the tree is empty or unreadable. Walks at most
 * {@link MAX_TYPEGEN_FILES} entries to bound the cost on large
 * generated trees.
 *
 * Necessary because the directory's own `mtimeMs` does not update
 * when existing files inside are rewritten — `kick typegen` can run
 * successfully and the directory stat still looks stale. The newest
 * file mtime is the honest measure.
 */
function newestFileMtime(dir: string, budget = MAX_TYPEGEN_FILES): number {
  let newest = 0
  let visited = 0
  const stack = [dir]
  while (stack.length > 0 && visited < budget) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (visited >= budget) break
      visited++
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      try {
        const m = statSync(full).mtimeMs
        if (m > newest) newest = m
      } catch {
        // skip unreadable files
      }
    }
  }
  return newest
}

const MAX_TYPEGEN_FILES = 2000

export function checkTypegenFreshness(ctx: DoctorContext): DoctorResult | null {
  const typegenDir = join(ctx.cwd, '.kickjs', 'types')
  if (!existsSync(typegenDir)) return null
  const newest = newestFileMtime(typegenDir)
  if (newest === 0) return null
  const ageMs = Date.now() - newest
  const ageMin = Math.floor(ageMs / 60_000)
  if (ageMin > 60) {
    return {
      name: 'typegen freshness',
      status: 'warn',
      message: `last updated ${ageMin} minutes ago`,
      fix: 'Re-run `kick typegen` (or `kick dev`, which runs it on every reload) so generated types match the current code.',
    }
  }
  return {
    name: 'typegen freshness',
    status: 'pass',
    message: ageMin === 0 ? 'just now' : `${ageMin}m ago`,
  }
}

// ── Runner ────────────────────────────────────────────────────────────

const BUILT_IN_CHECKS: DoctorCheck[] = [
  () => checkNodeVersion(),
  checkKickJsInstalled,
  checkExpressInstalled,
  checkRuntimeEngine,
  checkUploadDriver,
  checkReflectMetadata,
  checkDecoratorTsConfig,
  checkEnvWiring,
  checkTypegenFreshness,
]

export async function runChecks(
  cwd: string,
  options: { extraChecks?: DoctorCheck[]; runtime?: AppRuntime } = {},
): Promise<DoctorResult[]> {
  const ctx: DoctorContext = {
    cwd,
    pkg: safeReadJson(join(cwd, 'package.json')),
    tsconfig: loadTsConfig(cwd),
    runtime: options.runtime ?? 'express',
  }
  const checks = [...BUILT_IN_CHECKS, ...(options.extraChecks ?? [])]
  const out: DoctorResult[] = []
  for (const check of checks) {
    // Per-check try/catch so one buggy extension can't abort the whole
    // report. A throwing check produces a synthetic `fail` result with
    // the error message; the loop continues to the next check.
    let r: DoctorResult | DoctorResult[] | null
    try {
      r = await check(ctx)
    } catch (err) {
      out.push({
        name: check.name || 'doctor check',
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    if (r == null) continue
    if (Array.isArray(r)) out.push(...r)
    else out.push(r)
  }
  return out
}

// ── Output ────────────────────────────────────────────────────────────

function statusTag(status: DoctorResult['status']): string {
  switch (status) {
    case 'pass':
      return colors.green('✔')
    case 'warn':
      return colors.yellow('⚠')
    case 'fail':
      return colors.red('✖')
  }
}

function formatResult(r: DoctorResult): string {
  const tag = statusTag(r.status)
  const tail = r.message ? `  ${colors.dim(`(${r.message})`)}` : ''
  return `${tag}  ${r.name}${tail}`
}

function formatFix(fix: string): string {
  return fix
    .split('\n')
    .map((line) => `   ${colors.dim('→')} ${line}`)
    .join('\n')
}

// ── Command registration ──────────────────────────────────────────────

function extractDoctorChecks(config: KickConfig | null): DoctorCheck[] {
  return config?.doctor?.checks ?? []
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Pre-flight checks for your KickJS project (dev environment health)')
    .action(async () => {
      const cwd = process.cwd()
      const config = await loadKickConfig(cwd)
      const extraChecks = extractDoctorChecks(config)
      const runtime = await resolveAppRuntime(cwd)

      intro('KickJS Doctor')

      const results = await runChecks(cwd, { extraChecks, runtime })

      for (const r of results) {
        log.message(formatResult(r))
        if (r.fix && r.status !== 'pass') {
          log.message(formatFix(r.fix))
        }
      }

      const passed = results.filter((r) => r.status === 'pass').length
      const warns = results.filter((r) => r.status === 'warn').length
      const fails = results.filter((r) => r.status === 'fail').length

      const passText = colors.green(`${passed} passed`)
      const warnText =
        warns > 0 ? colors.yellow(`${warns} warning${warns === 1 ? '' : 's'}`) : `${warns} warnings`
      const failText =
        fails > 0 ? colors.red(`${fails} error${fails === 1 ? '' : 's'}`) : `${fails} errors`
      const summary = [passText, warnText, failText].join(', ')

      if (fails > 0) {
        outro(`${summary} — fix the errors above before running the app`)
        process.exit(1)
      } else if (warns > 0) {
        outro(`${summary} — review the warnings`)
      } else {
        outro(colors.green(`${summary} — your environment looks good`))
      }
    })
}
