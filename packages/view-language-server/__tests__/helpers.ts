import * as view from '@forinda/kickjs-view'
import { Workspace, type WorkspaceOptions } from '../src/workspace'

export const ROOT = '/app'
export const uri = (name: string) => `file://${ROOT}/src/views/${name}.kick`

/** A workspace over in-memory files (paths relative to ROOT). */
export async function workspaceOf(
  files: Record<string, string>,
  layouts: Pick<WorkspaceOptions, 'layout' | 'baseLayout'> = {},
) {
  const disk = new Map(Object.entries(files).map(([p, s]) => [`${ROOT}/${p}`, s]))
  const ws = new Workspace({
    root: ROOT,
    viewsDir: `${ROOT}/src/views`,
    componentsDir: 'components',
    pipesFile: `${ROOT}/src/views/pipes.ts`,
    view,
    read: async (p) => disk.get(p),
    list: async (dir) =>
      [...disk.keys()].filter((p) => p.startsWith(`${dir}/`) && p.endsWith('.kick')),
    ...layouts,
  })
  await ws.load()
  return ws
}

/** `text` with `§` marking the cursor: the text without it and the cursor's position. */
export function cursor(marked: string) {
  const offset = marked.indexOf('§')
  const text = marked.slice(0, offset) + marked.slice(offset + 1)
  const before = text.slice(0, offset).split('\n')
  return { text, offset, position: { line: before.length - 1, character: before.at(-1)!.length } }
}

export const doc = (u: string, text: string) =>
  ({
    uri: u,
    languageId: 'kick',
    version: 1,
    getText: () => text,
    offsetAt: (p: { line: number; character: number }) => {
      const lines = text.split('\n')
      return lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
    },
    positionAt: (o: number) => {
      const before = text.slice(0, o).split('\n')
      return { line: before.length - 1, character: before.at(-1)!.length }
    },
  }) as never
