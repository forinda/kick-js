/**
 * Find a controller method in the project's source — what "open handler in
 * editor" needs. The running app knows the class and method names but not the
 * file (the dev server may have transformed it), so this reads `src/` for the
 * class declaration, then the method inside it.
 *
 * Read on each lookup rather than cached: it runs on a click, in development,
 * and files move under HMR.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export interface HandlerSource {
  /** Absolute path. */
  file: string
  /** Path relative to the project root, `/`-separated — for mapping into another checkout. */
  relative: string
  /** 1-based line of the method (or of the class, when the method isn't found). */
  line: number
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 1-based line of the handler inside `controller`, or `undefined` when the class isn't declared here. */
export function findHandlerLine(
  source: string,
  controller: string,
  handler: string,
): number | undefined {
  const cls = new RegExp(`\\bclass\\s+${escape(controller)}\\b`).exec(source)
  if (!cls) return undefined
  const lineAt = (offset: number) => source.slice(0, offset).split('\n').length
  const method = new RegExp(
    `^[ \\t]*(?:(?:public|private|protected|static|async|override)\\s+)*${escape(handler)}\\s*[(<]`,
    'm',
  ).exec(source.slice(cls.index))
  return lineAt(method ? cls.index + method.index + method[0].search(/\S/) : cls.index)
}

/** Locate `controller.handler` under `<root>/src` (or `<root>` when there is no `src/`). */
export function locateHandler(
  root: string,
  controller: string,
  handler: string,
): HandlerSource | undefined {
  const dir = existsSync(join(root, 'src')) ? join(root, 'src') : root
  const files = readdirSync(dir, { recursive: true, encoding: 'utf-8' }).filter(
    (f) =>
      /\.[mc]?tsx?$/.test(f) &&
      !/\.d\.[mc]?ts$/.test(f) &&
      !f.split(sep).includes('node_modules') &&
      !f.split(sep).includes('dist'),
  )
  for (const f of files) {
    const file = join(dir, f)
    let source: string
    try {
      source = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    if (!source.includes(controller)) continue
    const line = findHandlerLine(source, controller, handler)
    if (line !== undefined) {
      return { file, relative: relative(root, file).split(sep).join('/'), line }
    }
  }
  return undefined
}
