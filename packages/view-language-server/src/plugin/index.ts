/**
 * The kick service plugin: diagnostics, completion, hover, go to definition
 * and formatting on the root `.kick` document. The embedded HTML / CSS / JS
 * codes are left to their own services.
 */
import type { LanguageServicePlugin } from '@volar/language-service'
import type { Workspace } from '../workspace'
import { completions } from './completion'
import { definition } from './definition'
import { createDiagnosticsPlugin, sourceUri } from './diagnostics'
import { formatEdits } from './format'
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
      documentFormattingProvider: true,
    },
    create(context) {
      /** The source file's uri and text, with the workspace synced to the buffer. */
      const open = (document: { uri: string; languageId: string; getText(): string }) => {
        if (document.languageId !== 'kick') return undefined
        const uri = sourceUri(context, document.uri)
        const text = document.getText()
        ws.sync(uri, text)
        return { uri, text }
      }
      return {
        ...diagnostics.create(context),
        provideCompletionItems(document, position) {
          const d = open(document)
          if (!d) return undefined
          const items = completions(ws, d.uri, d.text, document.offsetAt(position))
          return items.length ? { isIncomplete: false, items } : undefined
        },
        provideHover(document, position) {
          const d = open(document)
          return d
            ? (hover(ws, d.uri, d.text, document.offsetAt(position)) ?? undefined)
            : undefined
        },
        provideDefinition(document, position) {
          const d = open(document)
          const link = d && definition(ws, d.uri, d.text, document.offsetAt(position))
          return link ? [link] : undefined
        },
        provideDocumentFormattingEdits(document, _range, options) {
          const d = open(document)
          if (!d) return undefined
          return formatEdits(
            ws.view,
            d.text,
            `${ws.nameOf(d.uri) ?? 'template'}.kick`,
            options.tabSize,
          )
        },
      }
    },
  }
}
