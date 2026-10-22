/**
 * Template diagnostics as a Volar service plugin — the shape of Vue's
 * `vue-compiler-dom-errors`, around the engine's own `parse` + `check`.
 */
import type { LanguageServicePlugin } from '@volar/language-service'
import type { Workspace } from '../workspace'

export function createDiagnosticsPlugin(ws: Workspace): LanguageServicePlugin {
  return {
    name: 'kick-diagnostics',
    capabilities: {
      // A component or layout changing changes its users' diagnostics.
      diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
    },
    create() {
      return {
        provideDiagnostics(document) {
          if (document.languageId !== 'kick') return undefined
          // The document's text is the editor's buffer: the workspace checks that.
          ws.sync(document.uri, document.getText())
          return ws.diagnosticsFor(document.uri)
        },
      }
    },
  }
}
