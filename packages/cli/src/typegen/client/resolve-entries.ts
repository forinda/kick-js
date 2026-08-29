/**
 * Resolve every route entry to a concrete type, using the server's own
 * program.
 *
 * The mechanism is deliberately small: synthesise one source file of type
 * aliases over the map typegen already emits —
 *
 *     type _K0 = KickRoutes.Api['GET /terms']
 *
 * — and ask the checker what each one is. That reuses `InferHandlerResponse`
 * and the schema wiring verbatim instead of reimplementing them, which is what
 * guarantees the client map cannot drift from the ambient map: there is only
 * one inference path, and this evaluates it.
 *
 * Resolving the WHOLE entry rather than just `response` is the same argument
 * applied to `params` / `body` / `query`, which are emitted as
 * `import('zod').infer<typeof _S0>` and drag the schema modules for the same
 * reason the response drags the controllers.
 *
 * @module @forinda/kickjs-cli/typegen/client/resolve-entries
 */
import { basename, dirname, join } from 'node:path'

import type ts from '@typescript/typescript6'

import { loadCompilerApi, type TsApi } from './ts-compiler'
import { TypeExpander } from './expand-type'

export interface ResolvedClientMap {
  /** Route key (`'GET /users/:id'`) → expanded entry source text. */
  entries: Map<string, string>
  /** `interface __T0 { … }` blocks to emit above the map. */
  hoisted: string[]
}

export interface ResolveClientMapOptions {
  /** Project root — holds `tsconfig.json`, and is where the program is built. */
  projectDir: string
  /**
   * Directory to resolve the compiler API from. Defaults to `projectDir`,
   * which is what production wants: the program must be built by the same
   * TypeScript that checks the server. Tests point it elsewhere so a fixture
   * project needs no `node_modules` of its own.
   */
  compilerFrom?: string
  /** Absolute path to the generated `kick__routes.ts`. */
  routesFile: string
  /** Route keys, e.g. `'GET /users/:id'`. */
  keys: string[]
  onWarn?: (msg: string) => void
}

const PROBE = '__kick_client_probe__.ts'

export async function resolveClientMap(opts: ResolveClientMapOptions): Promise<ResolvedClientMap> {
  const t = await loadCompilerApi(opts.compilerFrom ?? opts.projectDir)
  const probePath = join(dirname(opts.routesFile), PROBE)
  const probeSource = renderProbe(opts.routesFile, opts.keys)

  const program = createProbeProgram(t, opts.projectDir, probePath, probeSource)
  const checker = program.getTypeChecker()
  const probe = program.getSourceFile(probePath)
  if (!probe) {
    throw new Error(
      `kick/client: could not add the resolution probe to the program. ` +
        `Check that ${opts.routesFile} exists — run \`kick typegen\` first.`,
    )
  }

  // If the routes file itself does not compile, every controller reference in
  // it is an error type and every entry below resolves to `any`. That is the
  // worst possible output: a map that looks like a typed client and checks
  // nothing, emitted without a single warning. Refuse it — the caller turns a
  // throw into "warn, skip, and delete any stale map".
  assertRoutesFileCompiles(t, program, opts.routesFile)

  // A key the map does not carry is a compile error on its own alias. Reading
  // that from the diagnostics is exact, where inspecting the resolved type
  // would confuse "missing route" with "route whose entry really is `any`".
  const broken = keysWithDiagnostics(t, program, probe, opts.keys)

  const expander = new TypeExpander(t, checker, program, { onWarn: opts.onWarn })
  const entries = new Map<string, string>()

  for (const [index, key] of opts.keys.entries()) {
    if (broken.has(key)) {
      opts.onWarn?.(
        `route '${key}' is not present in KickRoutes.Api — skipped. ` +
          `Re-run \`kick typegen\` so the two maps agree.`,
      )
      continue
    }
    const alias = probe.statements.find(
      (s): s is ts.TypeAliasDeclaration =>
        t.isTypeAliasDeclaration(s) && s.name.text === aliasName(index),
    )
    if (!alias) {
      opts.onWarn?.(`route '${key}' could not be resolved — skipped.`)
      continue
    }
    const type = checker.getTypeAtLocation(alias.type)
    // A whole route entry is never legitimately `any` — the ambient map always
    // gives an object with params/body/query/response. `any` here means the
    // checker gave up on something, and emitting it would hand the frontend a
    // route that accepts anything at all.
    if (type.flags & t.TypeFlags.Any) {
      opts.onWarn?.(
        `route '${key}' resolved to 'any' — skipped rather than emitted, since an ` +
          `'any' entry silently accepts every call. Check that the server type-checks.`,
      )
      continue
    }
    entries.set(key, expander.expand(type))
  }

  return { entries, hoisted: expander.hoisted() }
}

/**
 * Fail loudly when the generated routes file does not compile.
 *
 * Its diagnostics are the difference between "this app has no typed responses"
 * and "this program could not resolve anything" — and the two look identical in
 * the output, because both end in entries the checker will not narrow. The
 * second one produced 1,940 routes of `response: any` with zero warnings when a
 * project's dependencies were missing.
 */
function assertRoutesFileCompiles(t: TsApi, program: ts.Program, routesFile: string): void {
  const source = program.getSourceFile(routesFile)
  if (!source) {
    throw new Error(
      `kick/client: ${routesFile} is not in the TypeScript program. ` +
        `Run \`kick typegen\` first, and check that tsconfig.json includes .kickjs.`,
    )
  }
  const diagnostics = program.getSemanticDiagnostics(source)
  if (diagnostics.length === 0) return
  const first = diagnostics
    .slice(0, 3)
    .map((d) => `    ${t.flattenDiagnosticMessageText(d.messageText, ' ')}`)
    .join('\n')
  throw new Error(
    `${routesFile} has ${diagnostics.length} type error(s), so its route types cannot ` +
      `be resolved — every entry would come out as 'any'.\n${first}\n` +
      `  Usually this means dependencies are not installed or the server does not type-check.`,
  )
}

function aliasName(index: number): string {
  return `_K${index}`
}

/** One import (to activate the global augmentation) plus one alias per key. */
function renderProbe(routesFile: string, keys: string[]): string {
  const specifier = './' + basename(routesFile).replace(/\.tsx?$/, '')
  const aliases = keys.map(
    (key, i) => `type ${aliasName(i)} = KickRoutes.Api[${JSON.stringify(key)}]`,
  )
  return [`import ${JSON.stringify(specifier)}`, ...aliases].join('\n') + '\n'
}

/**
 * Which keys have an error on their own alias declaration. Diagnostics carry a
 * character offset, so each one is attributed to the alias whose span contains
 * it, and every other diagnostic in the file is ignored — a broken route must
 * not take down the routes that are fine.
 */
function keysWithDiagnostics(
  t: TsApi,
  program: ts.Program,
  probe: ts.SourceFile,
  keys: string[],
): Set<string> {
  const broken = new Set<string>()
  const spans = new Map<string, ts.TypeAliasDeclaration>()
  for (const stmt of probe.statements) {
    if (t.isTypeAliasDeclaration(stmt)) spans.set(stmt.name.text, stmt)
  }

  for (const diag of program.getSemanticDiagnostics(probe)) {
    if (diag.start === undefined) continue
    for (const [index, key] of keys.entries()) {
      const alias = spans.get(aliasName(index))
      if (!alias) continue
      if (diag.start >= alias.getStart(probe) && diag.start < alias.getEnd()) {
        broken.add(key)
      }
    }
  }
  return broken
}

/**
 * Build a program over the project's tsconfig with the probe added as a root.
 *
 * The probe lives only in memory. Writing it would leave a stray file in
 * `.kickjs/types/` whenever the pass is interrupted, and that file would then
 * be picked up by the next run's `include`.
 */
function createProbeProgram(
  t: TsApi,
  projectDir: string,
  probePath: string,
  probeSource: string,
): ts.Program {
  const configPath = join(projectDir, 'tsconfig.json')
  const host: ts.ParseConfigFileHost = {
    ...t.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(t.flattenDiagnosticMessageText(d.messageText, '\n'))
    },
  }
  const parsed = t.getParsedCommandLineOfConfigFile(configPath, {}, host)
  if (!parsed) {
    throw new Error(`kick/client: could not read ${configPath}`)
  }

  const compilerHost = t.createCompilerHost(parsed.options, true)
  const readFile = compilerHost.readFile.bind(compilerHost)
  const getSourceFile = compilerHost.getSourceFile.bind(compilerHost)
  const fileExists = compilerHost.fileExists.bind(compilerHost)

  compilerHost.readFile = (name) => (name === probePath ? probeSource : readFile(name))
  compilerHost.fileExists = (name) => name === probePath || fileExists(name)
  compilerHost.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === probePath
      ? t.createSourceFile(name, probeSource, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreate)

  return t.createProgram({
    rootNames: [...parsed.fileNames, probePath],
    options: parsed.options,
    host: compilerHost,
  })
}
