/**
 * The kick service plugin: diagnostics, completion, hover, go to definition
 * and formatting on the root `.kick` document. The embedded HTML / CSS / JS
 * codes are left to their own services.
 */
import type { LanguageServicePlugin, SemanticToken } from '@volar/language-service'
import type { Workspace } from '../workspace'
import { completions, componentOf } from './completion'
import { definition } from './definition'
import { createDiagnosticsPlugin, sourceUri } from './diagnostics'
import { formatEdits } from './format'
import { hover } from './hover'
import { fileRenameEdits, references, renameEdits, renameRange } from './references'
import { renderCompletions, renderDefinition } from './render-calls'
import { kickTokens, TOKEN_TYPES } from './tokens'

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
      semanticTokensProvider: { legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [] } },
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      fileRenameEditsProvider: true,
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
          if (document.languageId === 'kick-render') {
            const items = renderCompletions(ws, document.getText(), document.offsetAt(position))
            return items && { isIncomplete: false, items }
          }
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
          if (document.languageId === 'kick-render') {
            const link = renderDefinition(ws, document.getText(), document.offsetAt(position))
            return link ? [link] : undefined
          }
          const d = open(document)
          const link = d && definition(ws, d.uri, d.text, document.offsetAt(position))
          return link ? [link] : undefined
        },
        provideReferences(document, position, context) {
          const d = open(document)
          return d
            ? references(ws, d.text, document.offsetAt(position), context.includeDeclaration)
            : undefined
        },
        provideRenameRange(document, position) {
          const d = open(document)
          return d ? renameRange(ws, d.text, document.offsetAt(position)) : undefined
        },
        provideRenameEdits(document, position, newName) {
          const d = open(document)
          return d ? renameEdits(ws, d.text, document.offsetAt(position), newName) : undefined
        },
        provideFileRenameEdits(oldUri, newUri) {
          return fileRenameEdits(ws, oldUri.toString(), newUri.toString())
        },
        provideDocumentSemanticTokens(document, range, legend) {
          const d = open(document)
          if (!d) return undefined
          const tokens: SemanticToken[] = []
          for (const t of kickTokens(d.text, (tag) => componentOf(ws, tag) !== undefined)) {
            const type = legend.tokenTypes.indexOf(t.type)
            if (type < 0) continue
            // One token per line: not every client takes multi-line tokens.
            let at = t.offset
            for (const part of d.text.slice(t.offset, t.offset + t.length).split('\n')) {
              const p = document.positionAt(at)
              if (part && p.line >= range.start.line && p.line <= range.end.line)
                tokens.push([p.line, p.character, part.length, type, 0])
              at += part.length + 1
            }
          }
          return tokens
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
