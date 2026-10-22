/**
 * Template diagnostics as a Volar service plugin — the shape of Vue's
 * `vue-compiler-dom-errors`, around the engine's own `parse` + `check`.
 */
import type { LanguageServiceContext, LanguageServicePlugin } from '@volar/language-service'
import { URI } from 'vscode-uri'
import type { Workspace } from '../workspace'
import { renderDiagnostics } from './render-calls'

/** The `.kick` file a root virtual-code document belongs to. */
export function sourceUri(context: LanguageServiceContext, uri: string): string {
  return context.decodeEmbeddedDocumentUri?.(URI.parse(uri))?.[0].toString() ?? uri
}

export function createDiagnosticsPlugin(ws: Workspace): LanguageServicePlugin {
  return {
    name: 'kick-diagnostics',
    capabilities: {
      // A component or layout changing changes its users' diagnostics.
      diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
    },
    create(context) {
      return {
        provideDiagnostics(document) {
          if (document.languageId === 'kick-render')
            return renderDiagnostics(ws, document.getText())
          if (document.languageId !== 'kick') return undefined
          // The document's text is the editor's buffer: the workspace checks that.
          const uri = sourceUri(context, document.uri)
          ws.sync(uri, document.getText())
          return ws.diagnosticsFor(uri)
        },
      }
    },
  }
}
