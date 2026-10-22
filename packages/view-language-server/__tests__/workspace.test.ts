import { describe, expect, it, vi } from 'vitest'
import * as view from '@forinda/kickjs-view'
import { Workspace } from '../src/workspace'

const ROOT = '/app'

function workspace(files: Record<string, string>) {
  const disk = new Map(Object.entries(files).map(([p, s]) => [`${ROOT}/${p}`, s]))
  const check = vi.spyOn(view, 'check')
  const ws = new Workspace({
    root: ROOT,
    viewsDir: `${ROOT}/src/views`,
    componentsDir: 'components',
    pipesFile: `${ROOT}/src/views/pipes.ts`,
    view: { ...view, check } as never,
    read: async (p) => disk.get(p),
    list: async (dir) =>
      [...disk.keys()].filter((p) => p.startsWith(`${dir}/`) && p.endsWith('.kick')),
  })
  return { ws, disk, check, uri: (name: string) => `file://${ROOT}/src/views/${name}.kick` }
}

describe('Workspace', () => {
  it('reports what check reports', async () => {
    const { ws, uri } = workspace({ 'src/views/a.kick': '{{ a() }}' })
    await ws.load()
    const [d, ...rest] = ws.diagnosticsFor(uri('a'))
    expect(rest).toEqual([])
    expect(d).toMatchObject({
      severity: 1,
      source: 'kick',
      range: { start: { line: 0, character: 4 } },
    })
    expect(d!.message).toContain("calls aren't allowed")
  })

  it('open buffers win over disk', async () => {
    const { ws, uri } = workspace({ 'src/views/a.kick': '{{ a }}' })
    await ws.load()
    expect(ws.diagnosticsFor(uri('a'))).toEqual([])
    ws.setBuffer(uri('a'), '{{ a | nope }}')
    expect(ws.diagnosticsFor(uri('a')).map((d) => d.message)).toEqual(["unknown pipe 'nope'"])
    ws.setBuffer(uri('a'), undefined)
    expect(ws.diagnosticsFor(uri('a'))).toEqual([])
  })

  it('re-checks dependents when a component disappears', async () => {
    const { ws, disk, uri } = workspace({
      'src/views/page.kick': '<x-card />',
      'src/views/components/x-card.kick': '<b>card</b>',
    })
    await ws.load()
    expect(ws.diagnosticsFor(uri('page'))).toEqual([])
    disk.delete(`${ROOT}/src/views/components/x-card.kick`)
    await ws.fileDeleted(`${ROOT}/src/views/components/x-card.kick`)
    expect(ws.diagnosticsFor(uri('page')).map((d) => d.message)[0]).toContain(
      "<x-card> isn't a component",
    )
    expect(ws.dependentsOf('components/x-card')).toEqual(new Set())
  })

  it('checks only the changed file and its dependents', async () => {
    const files: Record<string, string> = { 'src/views/layouts/main.kick': '<main><slot /></main>' }
    for (let i = 0; i < 50; i++)
      files[`src/views/p${i}.kick`] = i < 5 ? "@layout('layouts/main')x" : 'x'
    const { ws, check, uri } = workspace(files)
    await ws.load()
    for (let i = 0; i < 50; i++) ws.diagnosticsFor(uri(`p${i}`))
    check.mockClear()
    ws.setBuffer(uri('p10'), 'y')
    for (let i = 0; i < 50; i++) ws.diagnosticsFor(uri(`p${i}`))
    expect(check.mock.calls.map((c) => c[0])).toEqual(['p10'])
    check.mockClear()
    ws.setBuffer(uri('layouts/main'), '<main><slot />!</main>')
    for (let i = 0; i < 50; i++) ws.diagnosticsFor(uri(`p${i}`))
    expect(check.mock.calls.map((c) => c[0]).toSorted()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(ws.dependentsOf('layouts/main')).toEqual(new Set(['p0', 'p1', 'p2', 'p3', 'p4']))
  })

  it('pipe names from pipes.ts', async () => {
    const { ws, disk, uri } = workspace({
      'src/views/a.kick': '{{ x | initials }}',
      'src/views/pipes.ts': 'export const initials = (v: string) => v[0]',
    })
    await ws.load()
    expect(ws.diagnosticsFor(uri('a'))).toEqual([])
    expect(ws.pipeNames()).toContain('initials')
    disk.set(`${ROOT}/src/views/pipes.ts`, 'export const other = 1')
    await ws.fileChanged(`${ROOT}/src/views/pipes.ts`)
    expect(ws.diagnosticsFor(uri('a')).map((d) => d.message)).toEqual(["unknown pipe 'initials'"])
  })

  it('parse errors are diagnostics', async () => {
    const { ws, uri } = workspace({ 'src/views/a.kick': '<a href={{ x }}>' })
    await ws.load()
    expect(ws.diagnosticsFor(uri('a'))[0]!.message).toContain('quote the value')
  })

  it('maps names and uris', async () => {
    const { ws, uri } = workspace({ 'src/views/users/show.kick': 'x' })
    await ws.load()
    expect(ws.nameOf(uri('users/show'))).toBe('users/show')
    expect(ws.uriOf('users/show')).toBe(uri('users/show'))
    expect(ws.nameOf('file:///elsewhere/x.kick')).toBeUndefined()
  })
})
