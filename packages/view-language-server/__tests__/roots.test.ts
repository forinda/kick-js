/** Named view roots in the editor: `billing::…` templates from another folder. */
import { describe, expect, it } from 'vitest'
import { definition } from '../src/plugin/definition'
import { completions } from '../src/plugin/completion'
import { hover } from '../src/plugin/hover'
import { renameEdits } from '../src/plugin/references'
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

describe('view roots in the editor — review fixes', () => {
  it("offers a root's component tags", async () => {
    const ws = await workspaceOf(FILES, { roots })
    const { text, offset } = cursor('<ui-b§')
    ws.setBuffer(uri('page'), text)
    const labels = completions(ws, uri('page'), text, offset).map((c) => c.label)
    expect(labels).toContain('ui-button')
  })

  it("re-checks app pages when a root component changes, and root pages when their root's layout does", async () => {
    const ws = await workspaceOf(
      {
        ...FILES,
        'src/views/page.kick': '<ui-button label="x"></ui-button>',
        'src/modules/ui/views/page.kick': "@layout('layouts/main')\n<p></p>",
      },
      { roots },
    )
    expect([...ws.dependentsOf('ui::components/button')]).toContain('page')
    expect([...ws.dependentsOf('ui::layouts/main')]).toContain('ui::page')
    expect([...ws.dependentsOf('layouts/main')]).not.toContain('ui::page')
  })

  it("doesn't offer a root's components as pages to render", async () => {
    const ws = await workspaceOf(FILES, { roots })
    const { text, offset } = cursor("@layout('§')\n<p></p>")
    ws.setBuffer(uri('page'), text)
    const labels = completions(ws, uri('page'), text, offset).map((c) => c.label)
    expect(labels).toContain('ui::page')
    expect(labels).not.toContain('ui::components/button')
  })

  it('maps a file inside a root to its full name, for renames', async () => {
    const ws = await workspaceOf(FILES, { roots })
    expect(ws.relOf(uiUri('page'))).toBe('ui::page.kick')
    expect(ws.relOf(`file://${UI}/layouts`)).toBe('ui::layouts')
  })
})

describe('view roots in the editor — PR review', () => {
  const BOTH = {
    ...FILES,
    'src/views/page.kick': '@layout(\'layouts/main\')\n<ui-button label="x"></ui-button>',
    'src/modules/ui/views/page.kick': "@layout('layouts/main')\n<p></p>",
  }
  const renamedFiles = (edit: ReturnType<typeof renameEdits>) =>
    (edit?.documentChanges ?? []).flatMap((c) => ('kind' in c ? [c.newUri] : []))
  const editedUris = (edit: ReturnType<typeof renameEdits>) =>
    (edit?.documentChanges ?? []).flatMap((c) => ('textDocument' in c ? [c.textDocument.uri] : []))

  it("renames the app's layout without touching a root page that means its own", async () => {
    const ws = await workspaceOf(BOTH, { roots })
    const { text, offset } = cursor('@layout(\'layouts/m§ain\')\n<ui-button label="x"></ui-button>')
    const edit = renameEdits(ws, text, offset, 'layouts/base', uri('page'))
    expect(editedUris(edit)).toEqual([uri('page')])
    expect(renamedFiles(edit)).toEqual([uri('layouts/base')])
  })

  it("renames a root's own layout, keeping it in the root", async () => {
    const ws = await workspaceOf(BOTH, { roots })
    const { text, offset } = cursor("@layout('layouts/m§ain')\n<p></p>")
    const edit = renameEdits(ws, text, offset, 'layouts/base', uiUri('page'))
    expect(editedUris(edit)).toEqual([uiUri('page')])
    expect(renamedFiles(edit)).toEqual([uiUri('layouts/base')])
  })

  it('renames a root component within its root', async () => {
    const ws = await workspaceOf(BOTH, { roots })
    const { text, offset } = cursor('@layout(\'layouts/main\')\n<ui-but§ton label="x"></ui-button>')
    const edit = renameEdits(ws, text, offset, 'ui-primary', uri('page'))
    expect(renamedFiles(edit)).toEqual([uiUri('components/primary')])
  })

  it('goes to a qualified layout from an app page', async () => {
    const ws = await workspaceOf(FILES, { roots })
    const { text, offset } = cursor("@layout('ui::layouts/m§ain')\n<p></p>")
    ws.setBuffer(uri('page'), text)
    expect(definition(ws, uri('page'), text, offset)!.targetUri).toBe(uiUri('layouts/main'))
  })

  it("re-checks a root page when its root's layout is deleted", async () => {
    const ws = await workspaceOf(
      {
        ...FILES,
        'src/modules/ui/views/layouts/card.kick': '<div><slot /></div>',
        'src/modules/ui/views/page.kick': "@layout('layouts/card')\n<p></p>",
      },
      { roots },
    )
    expect(ws.diagnosticsFor(uiUri('page'))).toEqual([])
    await ws.fileDeleted(`${UI}/layouts/card.kick`)
    expect(
      ws
        .diagnosticsFor(uiUri('page'))
        .map((d) => d.message)
        .join('\n'),
    ).toContain('not found')
  })
})
