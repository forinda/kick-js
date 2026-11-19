/**
 * The `kick/views` typegen: turns what each page reads (the checker's data
 * summary) into the `KickViews` registry, so `ctx.render(name, data)` and
 * `views.render(name, data)` check the name and the data.
 *
 * Writes `.kickjs/types/kick__views.ts` — a `.ts` file rather than a `.d.ts`,
 * so `skipLibCheck` doesn't hide a bad `@input` type or an `@import type` that
 * doesn't resolve.
 */
import { dirname, relative, resolve, sep } from 'node:path'
import type { CliTypegen } from '@forinda/kickjs-cli-kit'
import { check } from './check/check'
import { isComponent, resolveRef } from './check/project'
import { mergeSummary, summarize, type DataSummary, type Field, type Shape } from './check/summary'
import type { KickViewsCliOptions } from './cli'
import { loadViewsProject } from './load-project'
import { packageDir, resolveViewRoots, viewsConfigOf } from './roots'

/** One page: its name, its file (relative to the project root) and what it reads. */
export interface ViewTypesEntry {
  name: string
  file: string
  summary: DataSummary
}

const IDENT = /^[A-Za-z_$][\w$]*$/
const key = (k: string) =>
  IDENT.test(k) ? k : `'${k.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function shapeType(s: Shape): string {
  switch (s.k) {
    case 'unknown':
      return 'unknown'
    case 'object':
      return objectType(s.props)
    // What `@for` loops over: arrays and Sets (strings too, when items are
    // only printed); Maps or [key, value] lists for pairs. Not any iterable.
    case 'list': {
      const item = shapeType(s.item)
      const el = item.includes(' | ') ? `(${item})` : item
      return `readonly ${el}[] | ReadonlySet<${item}>${s.item.k === 'unknown' ? ' | string' : ''}`
    }
    case 'pairs': {
      const value = shapeType(s.value)
      return `ReadonlyMap<unknown, ${value}> | readonly (readonly [unknown, ${value}])[]`
    }
  }
}

function fieldType(f: Field): string {
  const t = shapeType(f.shape)
  if (f.nullable) return `${t} | null | undefined`
  // Read as is: present and not null, whatever else it is.
  return t === 'unknown' ? 'NonNullable<unknown>' : t
}

function objectType(props: Record<string, Field>): string {
  const parts = Object.entries(props).map(
    ([k, f]) => `${key(k)}${f.optional ? '?' : ''}: ${fieldType(f)}`,
  )
  return parts.length ? `{ ${parts.join('; ')} }` : '{}'
}

/**
 * A page's data type: declared `@input` types win over what's inferred.
 * `fields` defaults to the page's own; a fragment passes its reads (and only
 * those names count, declared or not).
 */
function dataType(s: DataSummary, fields = s.fields, onlyFields = false): string {
  const parts: string[] = []
  const names = (
    onlyFields
      ? Object.keys(fields)
      : [...new Set([...Object.keys(fields), ...Object.keys(s.declared)])]
  ).toSorted()
  for (const name of names) {
    const declared = s.declared[name]
    const field = fields[name]
    if (declared) {
      parts.push(
        `${key(name)}${declared.optional ? '?' : ''}: ${declared.type ?? (field ? fieldType(field) : 'unknown')}`,
      )
    } else if (field) {
      parts.push(`${key(name)}${field.optional ? '?' : ''}: ${fieldType(field)}`)
    }
  }
  return parts.length ? `{ ${parts.join('; ')} }` : '{}'
}

/** A relative specifier written in `templateFile`, as `outDir` reaches the same module. */
function repoint(spec: string, templateFile: string, outDir: string, root: string): string {
  const abs = resolve(root, dirname(templateFile), spec)
  const rel = relative(outDir, abs).split(sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** An `@import type` line, its relative specifier re-pointed from the template to `outDir`. */
function importLine(line: string, templateFile: string, outDir: string, root: string): string {
  return line.replace(
    /(\bfrom\s*)(['"])(\.[^'"]*)\2/,
    (_, from: string, q: string, spec: string) =>
      `${from}${q}${repoint(spec, templateFile, outDir, root)}${q}`,
  )
}

const escape = (name: string) => name.replace(/\$/g, '\\$')
/** `name` as a type reference: not part of a longer name, a member, or a property key. */
const refTo = (names: string[]) =>
  new RegExp(`(?<![\\w$.])(?:${names.map(escape).join('|')})(?![\\w$])(?!\\s*\\??\\s*:)`, 'g')

const STRINGS = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g

/** `type` with each name in `rename` replaced, string literals left alone. */
function renameRefs(type: string, rename: Map<string, string>): string {
  if (!rename.size) return type
  const ref = refTo([...rename.keys()])
  return type.replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|[^'"]+/g, (part, quoted) =>
    quoted ? part : part.replace(ref, (local) => rename.get(local)!),
  )
}

/**
 * The generated module: imports, then one `declare module` per package in
 * `modules` (the ones the app has installed), each adding every page to its
 * `KickViews`.
 */
export function renderViewTypes(
  entries: ViewTypesEntry[],
  opts: {
    modules: string[]
    outDir: string
    projectRoot: string
    /** The import lines when `aliasImports` already ran (the typegen does, before merging layouts). */
    aliased?: string[]
  },
): string {
  const { imports, entries: aliased } = opts.aliased
    ? { imports: opts.aliased, entries }
    : aliasImports(entries, opts)
  entries = aliased
  const body = entries
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      const fragments = Object.entries(e.summary.fragments)
        .map(
          ([name, f]) =>
            `${key(name)}: { needs: ${objectType(f.needs)}; reads: ${dataType(e.summary, f.reads, true)} }`,
        )
        .join('; ')
      return [
        `    // from ${e.file}`,
        `    ${key(e.name)}: {`,
        `      data: ${dataType(e.summary)}`,
        `      fragments: ${fragments ? `{ ${fragments} }` : '{}'}`,
        `    }`,
      ].join('\n')
    })
    .join('\n')
  const blocks = opts.modules.map(
    (m) => `declare module '${m}' {\n  interface KickViews {\n${body}\n  }\n}`,
  )
  return [
    '// Generated by `kick typegen` (kick/views) from your .kick templates. Do not edit.',
    ...imports,
    '',
    ...blocks,
    '',
    'export {}',
    '',
  ].join('\n')
}

/**
 * Every template's `@import type` lines as one set: relative paths re-pointed
 * at `outDir`, one line per module, and a name two templates import from
 * different modules aliased (`User as User_2`) — with that template's
 * declared types rewritten to match.
 */
export function aliasImports(
  entries: ViewTypesEntry[],
  opts: { outDir: string; projectRoot: string },
): { imports: string[]; entries: ViewTypesEntry[] } {
  // module → exported name → alias; and which import each alias belongs to.
  const byModule = new Map<string, Map<string, string>>()
  const owner = new Map<string, string>()
  const other = new Set<string>()
  const out = entries.map((e) => {
    const rename = new Map<string, string>()
    for (const line of e.summary.imports) {
      const rewritten = importLine(line, e.file, opts.outDir, opts.projectRoot)
      // Comments inside the braces aren't bindings.
      const m = /^import\s+type\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2$/.exec(
        rewritten.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      )
      if (!m) {
        other.add(rewritten)
        continue
      }
      const from = m[3]!
      const names = byModule.get(from) ?? new Map<string, string>()
      byModule.set(from, names)
      for (const spec of m[1]!.split(',')) {
        const sm = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(spec)
        if (!sm) continue
        const exported = sm[1]!
        const local = sm[2] ?? exported
        const id = `${from}\0${exported}`
        let alias = names.get(exported)
        if (!alias) {
          alias = local
          for (let n = 2; owner.has(alias) && owner.get(alias) !== id; n++) alias = `${local}_${n}`
          owner.set(alias, id)
          names.set(exported, alias)
        }
        if (alias !== local) rename.set(local, alias)
      }
    }
    // One pass over the original text, so `A → A_2` and `A_2 → A_2_2` don't
    // chain; and an inline `import('./x')` re-pointed like an `@import` line.
    const declared: DataSummary['declared'] = {}
    for (const [name, d] of Object.entries(e.summary.declared)) {
      const type = d.type
        ? renameRefs(d.type, rename).replace(
            /\bimport\(\s*(['"])(\.[^'"]*)\1\s*\)/g,
            (_, q: string, spec: string) =>
              `import(${q}${repoint(spec, e.file, opts.outDir, opts.projectRoot)}${q})`,
          )
        : undefined
      declared[name] = { ...d, ...(type ? { type } : {}) }
    }
    return { ...e, summary: { ...e.summary, declared } }
  })
  // Only the names a declared type uses: an unused import fails `noUnusedLocals`.
  // String literals don't count: `'User'` isn't a use of the type `User`.
  const used = out.flatMap((e) =>
    Object.values(e.summary.declared).map((d) => (d.type ?? '').replace(STRINGS, "''")),
  )
  const isUsed = (alias: string) => used.some((t) => refTo([alias]).test(t))
  const imports = [
    ...[...byModule].flatMap(([from, names]) => {
      const kept = [...names].filter(([, a]) => isUsed(a))
      return kept.length
        ? [
            `import type { ${kept.map(([x, a]) => (x === a ? x : `${x} as ${a}`)).join(', ')} } from '${from}'`,
          ]
        : []
    }),
    // `import type X from` / `import type * as X from`: kept when X is used.
    ...[...other].filter((line) => {
      const m = /^import\s+type\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\b/.exec(line.trim())
      return !m || isUsed(m[1]!)
    }),
  ]
  return { imports, entries: out }
}

const PACKAGES = ['@forinda/kickjs', '@forinda/kickjs-view'] as const

/** Is `pkg` installed for the project at `root`? (Not `require.resolve`, which a package's `exports` can refuse.) */
const installedIn =
  (root: string) =>
  (pkg: string): boolean =>
    packageDir(root, pkg) !== undefined

interface TypegenLog {
  warn(message: string): void
}

/** The `kick/views` typegen plugin. `deps.installed` stands in for module resolution in tests. */
export function viewsTypegen(
  options: KickViewsCliOptions = {},
  deps: { installed?: (pkg: string) => boolean } = {},
): CliTypegen {
  const dir = options.dir ?? 'src/views'
  return {
    id: 'kick/views',
    outExtension: '.ts',
    inputs: [`${dir}/**/*.kick`, options.pipes ?? `${dir}/pipes.ts`],
    async generate(ctx: { cwd: string; log: TypegenLog; config?: unknown }) {
      const views = viewsConfigOf(ctx.config)
      const loaded = await loadViewsProject({
        root: ctx.cwd,
        dir: options.dir ?? views?.dir ?? 'src/views',
        roots: resolveViewRoots(ctx.cwd, views).roots,
        componentsDir: options.componentsDir,
        pipesFile: options.pipes,
        validatorsFile: options.validators,
      })
      const installed = deps.installed ?? installedIn(ctx.cwd)
      const modules = PACKAGES.filter((m) => installed(m))
      if (!modules.length) return null
      const outDir = resolve(ctx.cwd, '.kickjs/types')
      // No templates left: an empty registry, so deleted names stop compiling.
      if (!loaded.names.length) {
        return renderViewTypes([], { modules, outDir, projectRoot: ctx.cwd, aliased: [] })
      }
      const summaries = new Map<string, DataSummary>()
      const failed: string[] = []
      for (const name of loaded.names) {
        if (isComponent(name, loaded.project.componentsDir)) continue
        const r = check(name, loaded.project)
        if (r.diagnostics.some((d) => d.severity === 'error') || loaded.unparsed.has(name)) {
          failed.push(name)
        }
        // The summary is typegen's own pass: the runtime check never computes it.
        summaries.set(name, summarize(loaded.project.templates.get(name)!))
      }
      if (failed.length) {
        ctx.log.warn(
          `kick/views: ${failed.join(', ')} ha${failed.length === 1 ? 's' : 've'} errors (kick check:views) — typed from what could be read`,
        )
      }
      // Imports aliased per template first, so a layout's types keep their
      // own names when its declarations merge into its pages.
      const aliased = aliasImports(
        [...summaries].map(([name, summary]) => ({ name, file: loaded.fileOf(name), summary })),
        { outDir, projectRoot: ctx.cwd },
      )
      for (const e of aliased.entries) summaries.set(e.name, e.summary)
      // A page's explicit @layout chain reads data too.
      const entries: ViewTypesEntry[] = []
      // A layout named in a root's template is that root's first (`resolveRef`).
      const layoutOf = (from: string, s: DataSummary) =>
        typeof s.layout === 'string'
          ? resolveRef(from, s.layout, (n) => summaries.has(n))
          : undefined
      for (const [name, summary] of summaries) {
        let merged = summary
        const seen = new Set([name])
        let next = layoutOf(name, summary)
        while (next !== undefined && !seen.has(next) && summaries.has(next)) {
          seen.add(next)
          const layout = summaries.get(next)!
          merged = mergeSummary(merged, layout)
          next = layoutOf(next, layout)
        }
        entries.push({ name, file: loaded.fileOf(name), summary: merged })
      }
      return renderViewTypes(entries, {
        modules,
        outDir,
        projectRoot: ctx.cwd,
        aliased: aliased.imports,
      })
    },
  }
}
