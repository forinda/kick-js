import { describe, expect, it } from 'vitest'
import { fileRenameEdits, references, renameEdits, renameRange } from '../src/plugin/references'
import { cursor, ROOT, uri, workspaceOf } from './helpers'

const PIPES = `${ROOT}/src/views/pipes.ts`

async function app() {
  return workspaceOf({
    'src/views/layouts/main.kick': '<slot />',
    'src/views/components/user-card.kick': '@input user\n<div>{{ user.name | shout }}</div>',
    'src/views/home.kick':
      '@layout(\'layouts/main\')\n<user-card [user]="u" />\n{{ title | shout }}',
    'src/views/about.kick': '@layout(\'layouts/main\')\n<user-card [user]="me"></user-card>',
    'src/views/pipes.ts': 'export const shout = (s: string) => s.toUpperCase()\n',
  })
}

/** `uri:line:col` for each location, sorted, for readable assertions. */
const where = (locs: { uri: string; range: { start: { line: number; character: number } } }[]) =>
  locs
    .map((l) => `${l.uri.split('/src/views/')[1]}:${l.range.start.line}:${l.range.start.character}`)
    .toSorted()

describe('references', () => {
  it('finds every use of a component, closing tags included', async () => {
    const ws = await app()
    const { text, offset } = cursor('<user-ca§rd [user]="u" />')
    expect(where(references(ws, text, offset, true))).toEqual([
      'about.kick:1:1',
      'about.kick:1:25',
      'components/user-card.kick:0:0',
      'home.kick:1:1',
    ])
    expect(where(references(ws, text, offset, false))).not.toContain(
      'components/user-card.kick:0:0',
    )
  })
  it('finds every page on a layout', async () => {
    const ws = await app()
    const { text, offset } = cursor("@layout('layouts/m§ain')")
    expect(where(references(ws, text, offset, false))).toEqual(['about.kick:0:9', 'home.kick:0:9'])
  })
  it('finds every use of a pipe and its declaration', async () => {
    const ws = await app()
    const { text, offset } = cursor('{{ x | sho§ut }}')
    expect(where(references(ws, text, offset, true))).toEqual([
      'components/user-card.kick:1:20',
      'home.kick:2:11',
      'pipes.ts:0:13',
    ])
  })
  it('finds nothing for plain HTML or names', async () => {
    const ws = await app()
    const { text, offset } = cursor('<di§v>{{ ti§tle }}</div>'.replace('§', ''))
    expect(references(ws, text, offset, true)).toEqual([])
  })
})

describe('rename', () => {
  it('renames a pipe everywhere, declaration included', async () => {
    const ws = await app()
    const { text, offset } = cursor('{{ x | sho§ut }}')
    expect(renameRange(ws, text, offset)).toEqual({
      start: { line: 0, character: 7 },
      end: { line: 0, character: 12 },
    })
    const edit = renameEdits(ws, text, offset, 'yell')!
    const all = Object.entries(edit.changes!).flatMap(([u, es]) =>
      es.map(
        (e) =>
          `${u.split('/src/views/')[1]}:${e.range.start.line}:${e.range.start.character}=${e.newText}`,
      ),
    )
    expect(all.toSorted()).toEqual([
      'components/user-card.kick:1:20=yell',
      'home.kick:2:11=yell',
      'pipes.ts:0:13=yell',
    ])
  })
  it("refuses names that aren't identifiers or are taken", async () => {
    const ws = await app()
    const { text, offset } = cursor('{{ x | sho§ut }}')
    expect(renameEdits(ws, text, offset, 'two words')).toBeUndefined()
    expect(renameEdits(ws, text, offset, 'uppercase')).toBeUndefined()
  })
  /** `uri:line:col=text` edits and `old -> new` file renames in a `documentChanges` edit. */
  const changes = (e: ReturnType<typeof renameEdits>) =>
    (e?.documentChanges ?? [])
      .flatMap((c) =>
        'kind' in c
          ? c.kind === 'rename'
            ? [`${c.oldUri.split('/src/views/')[1]} -> ${c.newUri.split('/src/views/')[1]}`]
            : []
          : c.edits.map(
              (x) =>
                `${c.textDocument.uri.split('/src/views/')[1]}:${x.range.start.line}:${x.range.start.character}=${(x as { newText: string }).newText}`,
            ),
      )
      .toSorted()

  it('renames a component: every tag, then the file', async () => {
    const ws = await app()
    const { text, offset } = cursor('<user-ca§rd />')
    expect(renameRange(ws, text, offset)).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 10 },
    })
    expect(changes(renameEdits(ws, text, offset, 'user-badge'))).toEqual([
      'about.kick:1:1=user-badge',
      'about.kick:1:25=user-badge',
      'components/user-card.kick -> components/user-badge.kick',
      'home.kick:1:1=user-badge',
    ])
    // Not a component name: no hyphen.
    expect(renameEdits(ws, text, offset, 'badge')).toBeUndefined()
  })
  it('keeps a nested component in its folder when the new tag allows', async () => {
    const ws = await workspaceOf({
      'src/views/components/forms/text-field.kick': '<input />',
      'src/views/page.kick': '<forms-text-field />',
    })
    const { text, offset } = cursor('<forms-te§xt-field />')
    expect(changes(renameEdits(ws, text, offset, 'forms-input'))).toEqual([
      'components/forms/text-field.kick -> components/forms/input.kick',
      'page.kick:0:1=forms-input',
    ])
  })
  it('renames a layout: every @layout, then the file', async () => {
    const ws = await app()
    const { text, offset } = cursor("@layout('layouts/m§ain')")
    expect(changes(renameEdits(ws, text, offset, 'layouts/site'))).toEqual([
      'about.kick:0:9=layouts/site',
      'home.kick:0:9=layouts/site',
      'layouts/main.kick -> layouts/site.kick',
    ])
    // Taken, or not a template name.
    expect(renameEdits(ws, text, offset, 'home')).toBeUndefined()
    expect(renameEdits(ws, text, offset, '../up')).toBeUndefined()
  })
})

describe('file rename', () => {
  const edits = (e: Awaited<ReturnType<typeof fileRenameEdits>>) =>
    Object.entries(e?.changes ?? {})
      .flatMap(([u, es]) =>
        es.map(
          (x) =>
            `${u.split('/src/views/')[1]}:${x.range.start.line}:${x.range.start.character}=${(x as { newText: string }).newText}`,
        ),
      )
      .toSorted()

  it('renaming a component updates its tags', async () => {
    const ws = await app()
    expect(
      edits(await fileRenameEdits(ws, uri('components/user-card'), uri('components/user-badge'))),
    ).toEqual([
      'about.kick:1:1=user-badge',
      'about.kick:1:25=user-badge',
      'home.kick:1:1=user-badge',
    ])
  })
  it('renaming a layout updates @layout', async () => {
    const ws = await app()
    expect(edits(await fileRenameEdits(ws, uri('layouts/main'), uri('layouts/site')))).toEqual([
      'about.kick:0:9=layouts/site',
      'home.kick:0:9=layouts/site',
    ])
  })
  it('renaming a folder updates what is inside it', async () => {
    const ws = await app()
    const dir = (p: string) => `file://${ROOT}/src/views/${p}`
    expect(edits(await fileRenameEdits(ws, dir('layouts'), dir('shells')))).toEqual([
      'about.kick:0:9=shells/main',
      'home.kick:0:9=shells/main',
    ])
  })
  it("renaming a page updates ctx.render('…') in controllers", async () => {
    const controller = `file://${ROOT}/src/home.controller.ts`
    const ws = await workspaceOf(
      {
        'src/views/home.kick': '<p></p>',
        'src/views/users/show.kick': '<p></p>',
      },
      {
        scripts: async () => [
          {
            uri: controller,
            text: "ctx.render('home')\nviews.render(\"users/show\", {})\nctx.render('other')",
          },
        ],
      },
    )
    const all = async (from: string, to: string) =>
      Object.entries((await fileRenameEdits(ws, from, to))?.changes ?? {}).flatMap(([u, es]) =>
        es.map(
          (x) =>
            `${u.split('/src/')[1]}:${x.range.start.line}:${x.range.start.character}=${x.newText}`,
        ),
      )
    expect(await all(uri('home'), uri('pages/home'))).toEqual([
      'home.controller.ts:0:12=pages/home',
    ])
    const dir = (p: string) => `file://${ROOT}/src/views/${p}`
    expect(await all(dir('users'), dir('people'))).toEqual(['home.controller.ts:1:14=people/show'])
  })
  it('ignores renames out of the views folder', async () => {
    const ws = await app()
    expect(
      await fileRenameEdits(ws, uri('layouts/main'), `file://${ROOT}/elsewhere/main.kick`),
    ).toBeUndefined()
  })
  void PIPES
})
