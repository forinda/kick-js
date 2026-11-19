/** Named view roots in the editor: `billing::…` templates from another folder. */
import { describe, expect, it } from 'vitest'
import { definition } from '../src/plugin/definition'
import { hover } from '../src/plugin/hover'
import { ROOT, cursor, uri, workspaceOf } from './helpers'

const UI = `${ROOT}/src/modules/ui/views`
const uiUri = (path: string) => `file://${UI}/${path}.kick`
const FILES = {
  'src/views/layouts/main.kick': '<slot />',
  'src/views/page.kick': '<p></p>',
  'src/modules/ui/views/layouts/main.kick': '<div><slot /></div>',
  'src/modules/ui/views/components/button.kick':
    '@input label: string\n<button>{{ label }}</button>',
  'src/modules/ui/views/broken.kick': '<p>{{ x | nopipe }}</p>',
  'src/modules/ui/views/page.kick': '<p></p>',
}
const roots = [{ name: 'ui', dir: UI }]

describe('view roots in the editor', () => {
  it('names a root file by its full name, and maps it back', async () => {
    const ws = await workspaceOf(FILES, { roots })
    expect(ws.nameOf(uiUri('page'))).toBe('ui::page')
    expect(ws.uriOf('ui::page')).toBe(uiUri('page'))
    expect(ws.names()).toContain('ui::components/button')
  })

  it("goes from a root page's @layout to the root's own layout", async () => {
    const ws = await workspaceOf(FILES, { roots })
    const { text, offset } = cursor("@layout('layouts/m§ain')\n<p></p>")
    ws.setBuffer(uiUri('page'), text)
    expect(definition(ws, uiUri('page'), text, offset)!.targetUri).toBe(uiUri('layouts/main'))
  })

  it('reports problems in a root file', async () => {
    const ws = await workspaceOf(FILES, { roots })
    const msgs = ws.diagnosticsFor(uiUri('broken')).map((d) => d.message)
    expect(msgs.join('\n')).toContain('nopipe')
  })

  it("hovers a root component's tag in an app page with its inputs", async () => {
    const ws = await workspaceOf(FILES, { roots })
    const { text, offset } = cursor('<ui-but§ton label="x"></ui-button>')
    ws.setBuffer(uri('page'), text)
    const h = hover(ws, uri('page'), text, offset)
    expect(JSON.stringify(h?.contents)).toContain('label')
  })
})
