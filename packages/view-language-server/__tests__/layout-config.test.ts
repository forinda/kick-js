import { describe, expect, it } from 'vitest'
import { createKickServicePlugin } from '../src/plugin/index'
import { cursor, doc, uri, workspaceOf } from './helpers'

const FILES = {
  'src/views/layouts/admin.kick': '<aside><slot name="nav" /></aside><slot />',
  'src/views/layouts/base.kick': '<head><slot name="head" /></head><slot />',
  'src/views/admin/users.kick':
    "@slot('nav') {\n<a>x</a>\n}\n@slot('head') {\n<title>t</title>\n}\n<p></p>",
}
const CONFIG = { layout: { admin: 'layouts/admin' }, baseLayout: 'layouts/base' }

const messages = (ws: Awaited<ReturnType<typeof workspaceOf>>, name: string) =>
  ws.diagnosticsFor(uri(name)).map((d) => d.message)

describe('layout mapping and base layout', () => {
  it('fills slots of the mapped layout and the base layout', async () => {
    expect(messages(await workspaceOf(FILES, CONFIG), 'admin/users')).toEqual([])
    // Without the app's config the editor can't know them.
    expect(messages(await workspaceOf(FILES), 'admin/users').join('\n')).toContain(
      "@slot('nav') has no layout to fill here",
    )
  })
  it('completes slot names from the mapped and base layouts', async () => {
    const ws = await workspaceOf(FILES, CONFIG)
    const service = createKickServicePlugin(ws).create({} as never)
    const { text, position } = cursor("@slot('§")
    const list = await service.provideCompletionItems!(
      doc(uri('admin/users'), text),
      position,
      {} as never,
      {} as never,
    )
    expect(list!.items.map((i) => i.label).toSorted()).toEqual(['head', 'nav'])
  })
  it('re-checks pages when a configured layout changes', async () => {
    const ws = await workspaceOf(FILES, CONFIG)
    expect(messages(ws, 'admin/users')).toEqual([])
    ws.setBuffer(uri('layouts/admin'), '<slot />')
    expect(messages(ws, 'admin/users').join('\n')).toContain("the layout has no slot 'nav'")
  })
})
