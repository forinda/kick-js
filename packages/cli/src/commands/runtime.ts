/**
 * `kick runtime [engine]` — show the HTTP engine the app boots on, or move it
 * to another: the entry file's `runtime:` and its import, Express's body
 * parser, kick.config.ts's `runtime`, and the engine's packages. Code that uses
 * the old engine directly is listed for review, never rewritten.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Command } from 'commander'
import { resolvePackageManagerWithSource } from '../utils/package-manager'
import { runCommand } from '../utils/shell'
import { swapConfigRuntime, swapRuntime } from '../scaffold/runtime-swap'
import { dirtyFiles, findEntry } from './add-wire'
import {
  ENGINE_PEERS,
  UPLOAD_DRIVERS,
  parseRuntimeFlag,
  resolveAppRuntimeDetailed,
  type AppRuntime,
} from './add'

/** What each engine's own code imports — what to flag after a move away from it. */
const ENGINE_IMPORTS: Record<AppRuntime, RegExp> = {
  express: /from ['"](express|@types\/express)['"]/,
  fastify: /from ['"](fastify|@fastify\/[^'"]+)['"]/,
  h3: /from ['"]h3['"]/,
}

/** `h3@^2` → `h3`, `@fastify/middie` stays. */
const packageName = (spec: string) => spec.replace(/(?<=.)@[^/]*$/, '')

export function registerRuntimeCommand(program: Command): void {
  program
    .command('runtime [engine]')
    .description('Show the HTTP engine, or move the app to another: express | fastify | h3')
    .option('--dry-run', 'Print what would change, and change nothing')
    .option('--no-install', 'Edit the files only; leave packages to you')
    .option('--pm <manager>', 'Package manager override')
    .option('--entry <file>', 'Entry file (default: src/index.ts, then src/main.ts)')
    .option('-f, --force', 'Edit files with uncommitted changes')
    .action(async (engine: string | undefined, opts: any) => {
      const cwd = process.cwd()
      const detection = await resolveAppRuntimeDetailed(cwd)

      if (!engine) {
        const how = detection.fromConfig ? 'kick.config.ts' : 'guessed from package.json'
        console.log(`\n  HTTP runtime: ${detection.runtime} (${how})`)
        if (detection.ambiguous) {
          console.log(`  Several engines are installed: ${detection.candidates.join(', ')}.`)
        }
        console.log('  Move to another with: kick runtime <express|fastify|h3>\n')
        return
      }

      let to: AppRuntime
      try {
        to = parseRuntimeFlag(engine)!
      } catch {
        console.error(`\n  Unknown engine '${engine}'. Expected express, fastify or h3.\n`)
        process.exitCode = 1
        return
      }
      if (detection.ambiguous && !detection.fromConfig) {
        console.error(
          `\n  Cannot tell which engine this app boots on now: found ` +
            `${detection.candidates.join(', ')} in package.json.\n` +
            `  Set \`runtime: '<engine>'\` in kick.config.ts, then rerun.\n`,
        )
        process.exitCode = 1
        return
      }
      const from = detection.runtime
      if (from === to) {
        console.log(`\n  Already on ${to}.\n`)
        return
      }

      const entry = findEntry(cwd, opts.entry)
      if (!entry) {
        console.error(`\n  No entry file (${opts.entry ?? 'src/index.ts or src/main.ts'}).\n`)
        process.exitCode = 1
        return
      }
      const config = ['kick.config.ts', 'kick.config.mts', 'kick.config.js'].find((f) =>
        existsSync(join(cwd, f)),
      )
      const dirty = dirtyFiles(cwd, [entry, ...(config ? [config] : [])])
      if (dirty.length > 0 && !opts.force && !opts.dryRun) {
        console.error(
          `\n  ${dirty.join(', ')} ${dirty.length === 1 ? 'has' : 'have'} uncommitted changes. ` +
            'Commit or stage them first, so this change is its own diff, or rerun with --force.\n',
        )
        process.exitCode = 1
        return
      }

      // The files.
      const swapped = swapRuntime(readFileSync(join(cwd, entry), 'utf-8'), from, to, entry)
      const configSource = config ? readFileSync(join(cwd, config), 'utf-8') : undefined
      const newConfig = configSource !== undefined ? swapConfigRuntime(configSource, to) : null

      // The packages: the new engine's in; the old one's out, unless code still imports them.
      const sources = sourceFiles(join(cwd, 'src')).map((file) => ({
        file,
        text: file === join(cwd, entry) ? swapped.source : readFileSync(file, 'utf-8'),
      }))
      const uploads = sources.some(({ text }) =>
        /@FileUpload\(|upload\.(single|array|none)\(/.test(text),
      )
      const pkg = readPackageJson(cwd)
      const { toAdd, toAddDev, toRemove, stillImported } = planRuntimePackages({
        from,
        to,
        installed: new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]),
        uploads,
        imported: (name) =>
          sources.some(({ text }) => new RegExp(`from ['"]${name}(/[^'"]*)?['"]`).test(text)),
      })

      // Code that uses the old engine directly: for review.
      const review: string[] = []
      for (const { file, text } of sources) {
        text.split('\n').forEach((line, i) => {
          if (ENGINE_IMPORTS[from].test(line) || /\bctx\.res\./.test(line)) {
            review.push(`${relative(cwd, file)}:${i + 1}  ${line.trim()}`)
          }
        })
      }

      console.log(`\n  ${from} → ${to}\n`)
      for (const change of swapped.changes) console.log(`  ${entry}: ${change}`)
      if (newConfig) console.log(`  ${config}: runtime: '${to}'`)
      if (toAdd.length) console.log(`  + ${toAdd.join(', ')}`)
      if (toAddDev.length) console.log(`  + ${toAddDev.join(', ')} (dev)`)
      if (toRemove.length) console.log(`  - ${toRemove.join(', ')}`)
      if (stillImported.length) {
        console.log(`  kept ${stillImported.join(', ')}: still imported in src/`)
      }
      if (opts.dryRun) {
        console.log('\n  Dry run: nothing changed.\n')
        printReview(swapped.manual, review, from)
        return
      }

      writeFileSync(join(cwd, entry), swapped.source)
      if (newConfig !== null) writeFileSync(join(cwd, config!), newConfig)

      let ok = true
      if (opts.install !== false) {
        const { pm } = await resolvePackageManagerWithSource(opts.pm)
        // An argument list, no shell: package names never pass through one.
        const run = (args: string[]) => {
          const cmd = [pm, ...args].join(' ')
          console.log(`\n  ${cmd}`)
          try {
            runCommand(pm, args, { cwd })
          } catch {
            ok = false
            console.log(`  Failed. Run it yourself:\n    ${cmd}`)
          }
        }
        if (toAdd.length) run(['add', ...toAdd])
        if (toAddDev.length) run(['add', '-D', ...toAddDev])
        if (toRemove.length) run([pm === 'npm' ? 'uninstall' : 'remove', ...toRemove])
      }

      printReview(swapped.manual, review, from)
      console.log(
        ok
          ? `  Done. Run \`kick typegen\` and your typecheck to see the rest.\n`
          : `  Files changed; the package step above did not finish.\n`,
      )
      if (!ok) process.exitCode = 1
    })
}

/**
 * The packages a move between engines adds and removes: the new engine's peers
 * (and its multipart parser when the app takes uploads, with its types on
 * Express); the old engine's, with its upload driver, out — unless code in
 * `src/` still imports one.
 */
export function planRuntimePackages(input: {
  from: AppRuntime
  to: AppRuntime
  /** Names in package.json's dependencies and devDependencies. */
  installed: ReadonlySet<string>
  /** Whether a route takes uploads (`@FileUpload` / `upload.*()`). */
  uploads: boolean
  /** Whether code in `src/` imports `name`. */
  imported: (name: string) => boolean
}): { toAdd: string[]; toAddDev: string[]; toRemove: string[]; stillImported: string[] } {
  const { from, to, installed, uploads, imported } = input
  const addProd = [
    ...ENGINE_PEERS[to],
    ...(uploads && UPLOAD_DRIVERS[to].prod ? [UPLOAD_DRIVERS[to].prod!] : []),
  ]
  const addDev = [
    ...(to === 'express' ? ['@types/express'] : []),
    ...(uploads && UPLOAD_DRIVERS[to].dev ? [UPLOAD_DRIVERS[to].dev!] : []),
  ]
  const keep = new Set([...addProd, ...addDev].map(packageName))
  const remove = [
    ...ENGINE_PEERS[from],
    ...(from === 'express' ? ['@types/express'] : []),
    ...(UPLOAD_DRIVERS[from].prod ? [UPLOAD_DRIVERS[from].prod!] : []),
    ...(UPLOAD_DRIVERS[from].dev ? [UPLOAD_DRIVERS[from].dev!] : []),
  ]
    .map(packageName)
    .filter((name) => installed.has(name) && !keep.has(name))
  const stillImported = remove.filter((name) => imported(name.replace(/^@types\//, '')))
  return {
    toAdd: addProd.filter((spec) => !installed.has(packageName(spec))),
    toAddDev: addDev.filter((spec) => !installed.has(packageName(spec))),
    toRemove: remove.filter((name) => !stillImported.includes(name)),
    stillImported,
  }
}

function printReview(manual: string[], review: string[], from: AppRuntime): void {
  for (const note of manual) console.log(`\n  ! ${note}`)
  if (review.length > 0) {
    console.log(`\n  Review — code that uses ${from} or the engine's response (ctx.res) directly:`)
    for (const line of review) console.log(`    ${line}`)
  }
  console.log()
}

function readPackageJson(cwd: string): {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
} {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
    return { dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {} }
  } catch {
    return { dependencies: {}, devDependencies: {} }
  }
}

/** Every TypeScript file under `dir`. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}
