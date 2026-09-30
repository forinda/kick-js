import { describe, it, expect, vi } from 'vitest'
import { Script } from 'node:vm'
import * as vscode from 'vscode'
import { DashboardPanel } from '../src/panels/dashboard'

/** Open the panel and return the HTML it rendered into the webview. */
function renderHtml(baseUrl: string, token?: string): string {
  const panel = { webview: { html: '' }, onDidDispose: vi.fn(), reveal: vi.fn(), dispose: vi.fn() }
  ;(vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mockReturnValueOnce(panel)
  DashboardPanel.currentPanel = undefined
  DashboardPanel.createOrShow({} as vscode.Uri, baseUrl, token)
  return panel.webview.html
}

function inlineScript(html: string): string {
  return html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))
}

describe('DashboardPanel webview', () => {
  it('renders a script that compiles', () => {
    const html = renderHtml('http://localhost:3000/_debug', 'tok')
    expect(() => new Script(inlineScript(html))).not.toThrow()
  })

  it('embeds the base URL as a JSON string literal', () => {
    const html = renderHtml(`http://h/'; alert(1); '`)
    expect(html).toContain(`const BASE = "http://h/'; alert(1); '";`)
    expect(() => new Script(inlineScript(html))).not.toThrow()
  })

  it('fetches the extended endpoints', () => {
    const script = inlineScript(renderHtml('http://localhost:3000/_debug'))
    for (const path of ['/runtime', '/topology', '/graph', '/queues', '/ws']) {
      expect(script).toContain(`getJson('${path}')`)
    }
  })
})
