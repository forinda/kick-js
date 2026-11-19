/**
 * Templates from a folder on disk (Node, Bun, Deno). The only module in the
 * package that touches the file system — the edge never loads it.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { qualify, splitName } from '../check/project'
import type { Loader } from '../views'

export function fileLoader(viewsDir: string): Loader {
  const root = resolve(viewsDir)
  const fileOf = (name: string) => join(root, `${name}.kick`)
  return {
    async list() {
      const entries = await readdir(root, { recursive: true, withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.kick'))
        .map((e) =>
          relative(root, join(direntDir(e), e.name))
            .slice(0, -'.kick'.length)
            .split(sep)
            .join('/'),
        )
        .toSorted()
    },
    read: (name) => readFile(fileOf(name), 'utf8'),
    version: async (name) => (await stat(fileOf(name))).mtimeMs,
  }
}

/** The app's pipes file, if there is one, imported as a module. */
/**
 * The app's views folder plus named roots: a root's templates are listed and
 * read as `root::path`.
 */
export function multiRootLoader(appDir: string, roots: Record<string, string>): Loader {
  const loaders = new Map<string | undefined, Loader>([[undefined, fileLoader(appDir)]])
  const dirs = new Map<string | undefined, string>([[undefined, resolve(appDir)]])
  for (const [name, dir] of Object.entries(roots)) {
    loaders.set(name, fileLoader(dir))
    dirs.set(name, resolve(dir))
  }
  const of = (name: string) => {
    const { root, path } = splitName(name)
    const l = loaders.get(root)
    if (!l) throw new Error(`no view root '${root}' for template '${name}'`)
    return { l, path, dir: dirs.get(root)! }
  }
  return {
    async list() {
      const all = await Promise.all(
        [...loaders].map(async ([root, l]) =>
          (await l.list().catch(() => [])).map((p) => qualify(root, p)),
        ),
      )
      return all.flat().toSorted()
    },
    read: (name) => {
      const { l, path } = of(name)
      return l.read(path)
    },
    version: (name) => {
      const { l, path } = of(name)
      return l.version!(path)
    },
    file: (name) => {
      const { path, dir } = of(name)
      return relative(process.cwd(), join(dir, `${path}.kick`))
        .split(sep)
        .join('/')
    },
  }
}

export async function loadPipesFile(file: string): Promise<Record<string, unknown> | undefined> {
  const path = resolve(file)
  try {
    await stat(path)
  } catch {
    return undefined
  }
  const { pathToFileURL } = await import('node:url')
  return (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Record<string, unknown>
}

/** A text file's contents, or undefined when there's none. */
export async function readTextFile(file: string): Promise<string | undefined> {
  try {
    return await readFile(resolve(file), 'utf8')
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return undefined
    throw err
  }
}

/** A dirent's folder: `parentPath` from Node 20.12, `path` before it. */
function direntDir(e: { parentPath?: string; path?: string }): string {
  return e.parentPath ?? e.path ?? ''
}
