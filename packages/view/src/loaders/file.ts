/**
 * Templates from a folder on disk (Node, Bun, Deno). The only module in the
 * package that touches the file system — the edge never loads it.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
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
