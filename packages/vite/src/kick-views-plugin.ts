/**
 * `virtual:kick-views` — the app's `.kick` templates, checked at build time
 * and shipped as data, plus its pipes file. A broken template fails the
 * build. Under `serve` the bundle is `null`: the app's file loader reads
 * templates and picks up edits on the next request.
 *
 * @module @forinda/kickjs-vite/kick-views-plugin
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

export interface KickViewsPluginOptions {
  /** Default `src/views`. */
  viewsDir?: string
  /** Default `src/views/pipes.ts`. */
  pipesFile?: string
  /** Default `components`, inside the views folder. */
  componentsDir?: string
}

const ID = 'virtual:kick-views'
const RESOLVED = '\0virtual:kick-views'

async function kickFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.kick'))
    .map((e) =>
      relative(dir, join(e.parentPath, e.name)).slice(0, -'.kick'.length).split(sep).join('/'),
    )
    .toSorted()
}

export function kickViewsPlugin(options: KickViewsPluginOptions = {}): Plugin {
  let viewsDir = ''
  let pipesFile = ''
  let build = true
  return {
    name: 'kickjs:views',
    configResolved(config) {
      viewsDir = resolve(config.root, options.viewsDir ?? 'src/views')
      pipesFile = resolve(config.root, options.pipesFile ?? 'src/views/pipes.ts')
      build = config.command === 'build'
    },
    resolveId(id) {
      return id === ID ? RESOLVED : undefined
    },
    async load(id) {
      if (id !== RESOLVED) return undefined
      const hasPipes = existsSync(pipesFile)
      const pipes = hasPipes
        ? `import * as pipes from ${JSON.stringify(pipesFile)}`
        : 'const pipes = {}'
      let bundle = 'null'
      if (build) {
        // The view package is optional: only apps that import this module need it.
        const view = await import('@forinda/kickjs-view')
        const names = await kickFiles(viewsDir)
        const errors: string[] = []
        const pipeNames = [...view.BUILTIN_PIPES]
        if (hasPipes) {
          const read = view.readPipeExports(await readFile(pipesFile, 'utf8'), pipesFile)
          pipeNames.push(...read.names)
          for (const d of read.diagnostics) {
            errors.push(`${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`)
          }
        }
        const templates = new Map()
        for (const name of names) {
          const file = join(viewsDir, `${name}.kick`)
          this.addWatchFile(file)
          const parsed = view.parse(await readFile(file, 'utf8'), `${name}.kick`)
          templates.set(name, parsed.ast)
          for (const d of parsed.diagnostics) {
            if (d.severity === 'error')
              errors.push(`${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`)
          }
        }
        const project = {
          templates,
          pipes: new Set(pipeNames),
          componentsDir: options.componentsDir ?? 'components',
        }
        const checked: Record<string, unknown> = {}
        for (const name of names) {
          const r = view.check(name, project)
          for (const d of r.diagnostics) {
            const line = `${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`
            if (d.severity === 'error') errors.push(line)
            else this.warn(line)
          }
          if (r.template) checked[name] = r.template
        }
        if (errors.length)
          this.error(`.kick templates have errors:\n  ${[...new Set(errors)].join('\n  ')}`)
        bundle = JSON.stringify({ v: view.AST_FORMAT_VERSION, templates: checked }, null, 1)
      }
      return [
        pipes,
        `const bundle = ${bundle};`,
        'export { bundle, pipes }',
        'export default { bundle, pipes }',
      ].join('\n')
    },
  }
}
