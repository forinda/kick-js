/**
 * The kick service plugin: diagnostics, completion, hover and go to
 * definition on the root `.kick` document. The embedded HTML / CSS / JS
 * codes are left to their own services.
 */
import type { LanguageServicePlugin } from '@volar/language-service'
import type { Workspace } from '../workspace'
import { completions } from './completion'
import { definition } from './definition'
import { createDiagnosticsPlugin } from './diagnostics'
import { hover } from './hover'

export function createKickServicePlugin(ws: Workspace): LanguageServicePlugin {
  const diagnostics = createDiagnosticsPlugin(ws)
  return {
    name: 'kick',
    capabilities: {
      ...diagnostics.capabilities,
      completionProvider: { triggerCharacters: ['@', '|', '<', '[', "'", '"'] },
      hoverProvider: true,
      definitionProvider: true,
    },
    create(context) {
      return {
        ...diagnostics.create(context),
        provideCompletionItems(document, position) {
          if (document.languageId !== 'kick') return undefined
          const text = document.getText()
          ws.sync(document.uri, text)
          const items = completions(ws, document.uri, text, document.offsetAt(position))
          return items.length ? { isIncomplete: false, items } : undefined
        },
        provideHover(document, position) {
          if (document.languageId !== 'kick') return undefined
          ws.sync(document.uri, document.getText())
          return (
            hover(ws, document.uri, document.getText(), document.offsetAt(position)) ?? undefined
          )
        },
        provideDefinition(document, position) {
          if (document.languageId !== 'kick') return undefined
          ws.sync(document.uri, document.getText())
          const link = definition(ws, document.uri, document.getText(), document.offsetAt(position))
          return link ? [link] : undefined
        },
      }
    },
  }
}
