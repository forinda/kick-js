/**
 * The editor's view of an app's templates: every `.kick` file under the
 * views folder (an open buffer wins over the file on disk) and the pipe names
 * from `pipes.ts`. Diagnostics come from the same `parse` + `check` the
 * runtime uses, cached per template and invalidated along the graph of
 * which template uses which component or layout.
 */
import { isAbsolute, posix, relative, sep } from 'node:path'
import type { Diagnostic } from '@volar/language-service'
import { URI } from 'vscode-uri'
import type * as View from '@forinda/kickjs-view'
import { pipeDeclarations, type PipeDeclaration } from './pipes'
import { toRange } from './positions'

/** The `@forinda/kickjs-view` module the server checks templates with. */
export type ViewModule = typeof View

/** Where a workspace's templates, pipes and validators live, and how to read them. */
export interface WorkspaceOptions {
  root: string
  /** Absolute. */
  viewsDir: string
  componentsDir: string
  /** Absolute. */
  pipesFile: string
  /** Absolute. The app's browser validators. Default `<viewsDir>/validators.ts`. */
  validatorsFile?: string
  view: ViewModule
  read(path: string): Promise<string | undefined>
  /** Every `.kick` file (absolute paths) under `dir`. */
  list(dir: string): Promise<string[]>
  /** `createViews({ layout })`: a page's layout when it declares none; one name, or folder prefix → layout. */
  layout?: string | Record<string, string>
  /** `createViews({ baseLayout })`: the shell around every page's outermost layout. */
  baseLayout?: string
  /** The project's TS / JS files with their text (an open buffer's when there is one), for `ctx.render('…')` names. */
  scripts?(): Promise<Array<{ uri: string; text: string }>>
  /** Named view roots (`ui::…`), absolute folders. */
  roots?: Array<{ name: string; dir: string }>
}

/** `ui::components/x` → root `ui`, path `components/x`. */
function split(name: string): { root?: string; path: string } {
  const at = name.indexOf('::')
  return at < 0 ? { path: name } : { root: name.slice(0, at), path: name.slice(at + 2) }
}

interface Entry {
  disk?: string
  buffer?: string
  ast: View.TemplateAst
  parseDiagnostics: View.Diagnostic[]
  /** Component tags and layout names the template refers to. */
  tags: Set<string>
  layouts: Set<string>
}

/**
 * The editor's view of an app's templates: every `.kick` file under the views folder (an open
 * buffer wins over the file on disk), with diagnostics from the same `parse` and `check` the runtime uses.
 */
export class Workspace {
  private readonly entries = new Map<string, Entry>()
  private readonly cache = new Map<string, Diagnostic[]>()
  private pipes: string[] = []
  private pipeDecls = new Map<string, PipeDeclaration>()
  private validators: string[] = []

  constructor(private readonly opts: WorkspaceOptions) {}

  get view(): ViewModule {
    return this.opts.view
  }

  async load(): Promise<void> {
    await this.loadPipes()
    await this.loadValidators()
    for (const { dir } of this.folders()) {
      for (const path of await this.opts.list(dir)) {
        const name = this.nameOfPath(path)
        if (name) this.update(name, { disk: await this.opts.read(path) })
      }
    }
  }

  /** The app's views folder, then each root's. */
  private folders(): Array<{ root?: string; dir: string }> {
    return [
      { dir: this.opts.viewsDir },
      ...(this.opts.roots ?? []).map((r) => ({ root: r.name, dir: r.dir })),
    ]
  }

  /** What `ref`, written in template `from`, names: its own root's template first, then the app's. */
  refOf(from: string | undefined, ref: string): string {
    const root = from === undefined ? undefined : split(from).root
    if (ref.includes('::') || root === undefined) return ref
    const own = `${root}::${ref}`
    return this.entries.has(own) ? own : ref
  }

  /** A template name's path, without its root. */
  pathPart(name: string): string {
    return split(name).path
  }

  /** A component: under the components folder, in the app's views or a root's. */
  isComponent(name: string): boolean {
    return split(name).path.startsWith(`${this.opts.componentsDir}/`)
  }

  // ── names ─────────────────────────────────────────────────────────────

  private nameOfPath(path: string): string | undefined {
    for (const { root, dir } of this.folders()) {
      const rel = relative(dir, path).split(sep).join(posix.sep)
      if (rel.startsWith('..') || isAbsolute(rel) || !rel.endsWith('.kick')) continue
      const name = this.opts.view.templateName(rel.slice(0, -'.kick'.length))
      return name && (root === undefined ? name : `${root}::${name}`)
    }
    return undefined
  }

  private dirOf(name: string): { dir: string; path: string } {
    const { root, path } = split(name)
    const dir =
      root === undefined ? this.opts.viewsDir : this.opts.roots?.find((r) => r.name === root)?.dir
    return { dir: dir ?? this.opts.viewsDir, path }
  }

  /**
   * `uri`'s path inside the views folder (`layouts/main.kick`, `layouts`), or
   * inside a root with its prefix (`ui::layouts`); `undefined` outside them.
   */
  relOf(uri: string): string | undefined {
    const path = URI.parse(uri).fsPath
    for (const { root, dir } of this.folders()) {
      const rel = relative(dir, path).split(sep).join(posix.sep)
      if (rel.startsWith('..') || isAbsolute(rel)) continue
      return root === undefined ? rel : `${root}::${rel}`
    }
    return undefined
  }

  nameOf(uri: string): string | undefined {
    return this.nameOfPath(URI.parse(uri).fsPath)
  }

  uriOf(name: string): string {
    return URI.file(this.pathOf(name)).toString()
  }

  componentsDir(): string {
    return this.opts.componentsDir
  }

  pathOf(name: string): string {
    const { dir, path } = this.dirOf(name)
    return `${dir}/${path}.kick`
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  textOf(name: string): string | undefined {
    const e = this.entries.get(name)
    return e?.buffer ?? e?.disk
  }

  astOf(name: string): View.TemplateAst | undefined {
    return this.entries.get(name)?.ast
  }

  // ── changes ───────────────────────────────────────────────────────────

  /** An editor buffer for `uri`; `undefined` drops it and the file on disk applies again. */
  setBuffer(uri: string, text: string | undefined): void {
    const name = this.nameOf(uri)
    if (!name) return
    const e = this.entries.get(name)
    if (text === undefined && e?.disk === undefined) {
      this.remove(name)
      return
    }
    this.update(name, { disk: e?.disk, buffer: text })
  }

  /** `setBuffer`, skipped when the buffer is already `text`. */
  sync(uri: string, text: string): void {
    if (this.textOf(this.nameOf(uri) ?? '') !== text) this.setBuffer(uri, text)
  }

  async fileChanged(path: string): Promise<void> {
    if (path === this.opts.pipesFile) {
      await this.loadPipes()
      this.cache.clear()
      return
    }
    if (path === this.validatorsFile()) {
      await this.loadValidators()
      this.cache.clear()
      return
    }
    const name = this.nameOfPath(path)
    if (name)
      this.update(name, {
        disk: await this.opts.read(path),
        buffer: this.entries.get(name)?.buffer,
      })
  }

  async fileDeleted(path: string): Promise<void> {
    if (path === this.opts.pipesFile) {
      this.pipes = []
      this.pipeDecls = new Map()
      this.cache.clear()
      return
    }
    if (path === this.validatorsFile()) {
      this.validators = []
      this.cache.clear()
      return
    }
    const name = this.nameOfPath(path)
    if (!name) return
    const buffer = this.entries.get(name)?.buffer
    // Still open in an editor: keep the buffer, but closing it now removes the template.
    if (buffer !== undefined) this.update(name, { buffer })
    else this.remove(name)
  }

  private validatorsFile(): string {
    return this.opts.validatorsFile ?? `${this.opts.viewsDir}/validators.ts`
  }

  /** An older view package without custom validators: none, and no crash. */
  private async loadValidators(): Promise<void> {
    const read = (this.opts.view as Partial<ViewModule>).readValidatorExports
    const source = read && (await this.opts.read(this.validatorsFile()))
    this.validators = source === undefined || !read ? [] : read(source, this.validatorsFile()).names
  }

  private async loadPipes(): Promise<void> {
    const source = await this.opts.read(this.opts.pipesFile)
    this.pipes =
      source === undefined ? [] : this.opts.view.readPipeExports(source, this.opts.pipesFile).names
    this.pipeDecls = source === undefined ? new Map() : pipeDeclarations(source)
  }

  private update(name: string, src: { disk?: string; buffer?: string }): void {
    const text = src.buffer ?? src.disk ?? ''
    const parsed = this.opts.view.parse(text, `${name}.kick`)
    const tags = new Set<string>()
    const layouts = new Set<string>()
    if (typeof parsed.ast.layout === 'string') layouts.add(parsed.ast.layout)
    const stack: View.Node[][] = [parsed.ast.body]
    while (stack.length) {
      for (const n of stack.pop()!) {
        if (n.k === 'element') {
          if (!n.foreign && n.tag.includes('-')) tags.add(n.tag.toLowerCase())
          // `<component of="a-b c-d">` depends on each candidate.
          if (!n.foreign && n.tag.toLowerCase() === 'component') {
            const of = n.attrs.find((a) => a.name.toLowerCase() === 'of' && a.kind === 'static')
            for (const t of String(of?.parts?.[0] ?? '').split(/\s+/))
              if (t) tags.add(t.toLowerCase())
          }
          stack.push(n.children)
        } else if (n.k === 'if') for (const b of n.branches) stack.push(b.body)
        else if (n.k === 'for') stack.push(n.body, n.empty ?? [])
        else if (n.k === 'switch') stack.push(...n.cases.map((c) => c.body), n.default ?? [])
        else if (n.k === 'slot-outlet') stack.push(n.fallback)
        else if (n.k === 'slot-fill' || n.k === 'fragment' || n.k === 'push' || n.k === 'snippet') {
          stack.push(n.body)
        }
      }
    }
    const isNew = !this.entries.has(name)
    this.entries.set(name, {
      ...src,
      ast: parsed.ast,
      parseDiagnostics: parsed.diagnostics,
      tags,
      layouts,
    })
    this.invalidate(name, isNew)
  }

  private remove(name: string): void {
    this.entries.delete(name)
    this.invalidate(name, true)
  }

  /** Drop cached diagnostics for `name` and every template that uses it, transitively. */
  private invalidate(name: string, membershipChanged: boolean): void {
    const todo = [name]
    const seen = new Set<string>()
    while (todo.length) {
      const n = todo.pop()!
      if (seen.has(n)) continue
      seen.add(n)
      this.cache.delete(n)
      for (const d of this.dependentsOf(n)) todo.push(d)
    }
    // A template appearing or disappearing can change how unknown tags resolve elsewhere.
    if (membershipChanged && this.isComponent(name)) {
      const tag = this.opts.view.componentTag(name, this.opts.componentsDir)
      for (const [n, e] of this.entries) if (e.tags.has(tag)) this.cache.delete(n)
    }
  }

  /** Templates that use `name` as a component or a layout — a layout even after it's gone. */
  dependentsOf(name: string): Set<string> {
    // A configured layout can wrap any page: re-check them all.
    if (this.configuredLayouts().has(name)) return new Set(this.names().filter((n) => n !== name))
    const out = new Set<string>()
    const tag = this.isComponent(name)
      ? this.opts.view.componentTag(name, this.opts.componentsDir)
      : undefined
    for (const [n, e] of this.entries) {
      if (n === name) continue
      // A layout as written; in a root's template it names the root's own first.
      const usesLayout = [...e.layouts].some((l) => this.refOf(n, l) === name)
      if ((tag && e.tags.has(tag) && this.entries.has(name)) || usesLayout) out.add(n)
    }
    return out
  }

  // ── what check sees ───────────────────────────────────────────────────

  pipeNames(): string[] {
    return [...this.opts.view.BUILTIN_PIPES, ...this.pipes]
  }

  /** Where an app pipe is declared in `pipes.ts`, and its parameters. */
  pipeDeclaration(name: string): PipeDeclaration | undefined {
    return this.pipeDecls.get(name)
  }

  pipesFile(): string {
    return this.opts.pipesFile
  }

  /** Validator names for completion: the built-ins and the app's. */
  validatorNames(): string[] {
    return [
      ...((this.opts.view as Partial<ViewModule>).BUILTIN_VALIDATORS ?? []),
      ...this.validators,
    ]
  }

  project(): View.Project {
    return {
      templates: new Map([...this.entries].map(([n, e]) => [n, e.ast])),
      pipes: new Set(this.pipeNames()),
      validators: new Set(this.validators),
      componentsDir: this.opts.componentsDir,
      layouts: this.opts.layout,
      baseLayout: this.opts.baseLayout,
    }
  }

  /** Templates that are layouts by configuration: the mapping's targets and the base layout. */
  configuredLayouts(): Set<string> {
    const { layout, baseLayout } = this.opts
    const out = new Set(typeof layout === 'string' ? [layout] : Object.values(layout ?? {}))
    if (baseLayout) out.add(baseLayout)
    return out
  }

  scripts(): Promise<Array<{ uri: string; text: string }>> {
    return this.opts.scripts?.() ?? Promise.resolve([])
  }

  baseLayout(): string | undefined {
    return this.opts.baseLayout
  }

  /**
   * The layout `name` renders in: its own `@layout`, else the configured
   * mapping's longest matching folder prefix (pages only, as `check` does).
   */
  layoutOf(name: string): string | undefined {
    const ast = this.astOf(name)
    if (!ast) return undefined
    if (ast.layout !== undefined) return ast.layout ? this.refOf(name, ast.layout) : undefined
    const { layout } = this.opts
    if (
      layout === undefined ||
      split(name).path.startsWith(`${this.opts.componentsDir}/`) ||
      this.configuredLayouts().has(name)
    )
      return undefined
    if (typeof layout === 'string') return layout
    const hit = Object.keys(layout)
      .toSorted((a, b) => b.length - a.length)
      .find((p) => p === '' || name === p || name.startsWith(`${p}/`))
    return hit === undefined ? undefined : layout[hit]
  }

  /** Parse errors, else everything `check` reports — as LSP diagnostics. */
  diagnosticsFor(uri: string): Diagnostic[] {
    const name = this.nameOf(uri)
    const e = name === undefined ? undefined : this.entries.get(name)
    if (!name || !e) return []
    const cached = this.cache.get(name)
    if (cached) return cached
    const engine = e.parseDiagnostics.some((d) => d.severity === 'error')
      ? e.parseDiagnostics
      : [...e.parseDiagnostics, ...this.opts.view.check(name, this.project()).diagnostics]
    const out = engine.map((d): Diagnostic => ({
      range: toRange(d.span),
      severity: d.severity === 'error' ? 1 : 2,
      source: 'kick',
      message: d.message,
    }))
    this.cache.set(name, out)
    return out
  }
}
