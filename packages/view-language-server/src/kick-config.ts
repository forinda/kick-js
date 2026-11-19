/**
 * The editor's views folder and named roots: the editor settings win, else
 * kick.config's `views` block (read through the project's CLI, only in a
 * trusted workspace — loading kick.config runs the project's code).
 */
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveViewRoots } from '@forinda/kickjs-view/cli'

interface ViewsBlock {
  dir?: string
  roots?: Record<string, string>
}

/** The views folder (when kick.config or the settings name one) and the roots, or why they're unusable. */
export function viewsSetup(
  root: string,
  settings: { viewsDir?: string; roots?: Record<string, string> },
  config: unknown,
): { viewsDir?: string; roots: Array<{ name: string; dir: string }>; error?: string } {
  const views = (config as { views?: ViewsBlock } | null | undefined)?.views
  const dir = settings.viewsDir ?? views?.dir
  const viewsDir = dir === undefined ? undefined : isAbsolute(dir) ? dir : resolve(root, dir)
  try {
    const roots = resolveViewRoots(root, { roots: settings.roots ?? views?.roots }).roots.map(
      ({ name, dir }) => ({ name, dir }),
    )
    return { ...(viewsDir ? { viewsDir } : {}), roots }
  } catch (err) {
    return { ...(viewsDir ? { viewsDir } : {}), roots: [], error: (err as Error).message }
  }
}

/** kick.config through the project's `@forinda/kickjs-cli`; `null` when it can't be loaded. */
export async function loadKickConfig(root: string): Promise<unknown> {
  try {
    const entry = createRequire(join(root, 'package.json')).resolve('@forinda/kickjs-cli')
    const cli = (await import(pathToFileURL(entry).href)) as {
      loadKickConfig?: (dir: string) => Promise<unknown>
    }
    return (await cli.loadKickConfig?.(root)) ?? null
  } catch {
    return null
  }
}
