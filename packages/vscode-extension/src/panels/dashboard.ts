import * as vscode from 'vscode'

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []

  private constructor(
    panel: vscode.WebviewPanel,
    private baseUrl: string,
  ) {
    this.panel = panel
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.panel.webview.html = this.getHtml()
  }

  public static createOrShow(extensionUri: vscode.Uri, baseUrl: string) {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal()
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'kickjsDashboard',
      'KickJS DevTools',
      vscode.ViewColumn.One,
      { enableScripts: true },
    )

    DashboardPanel.currentPanel = new DashboardPanel(panel, baseUrl)
  }

  private dispose() {
    DashboardPanel.currentPanel = undefined
    this.panel.dispose()
    for (const d of this.disposables) d.dispose()
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 16px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: var(--vscode-descriptionForeground); margin: 16px 0 8px; }
    .stat { display: flex; justify-content: space-between; padding: 4px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
    td { padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
    .badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; }
    .ok { background: #065f46; color: #6ee7b7; }
    .err { background: #7f1d1d; color: #fca5a5; }
    .info { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 16px; }
  </style>
</head>
<body>
  <h1>KickJS DevTools</h1>
  <div id="content">Connecting to ${this.baseUrl}...</div>
  <div class="info">Auto-refreshes every 30s</div>
  <script>
    const BASE = '${this.baseUrl}';
    async function load() {
      try {
        const [health, metrics, routes, container] = await Promise.all([
          fetch(BASE+'/health').then(r=>r.json()).catch(()=>null),
          fetch(BASE+'/metrics').then(r=>r.json()).catch(()=>null),
          fetch(BASE+'/routes').then(r=>r.json()).catch(()=>null),
          fetch(BASE+'/container').then(r=>r.json()).catch(()=>null),
        ]);
        let html = '';
        if (health) {
          html += '<h2>Health</h2>';
          html += '<div class="stat"><span>Status</span><span class="badge '+(health.status==='healthy'?'ok':'err')+'">'+health.status+'</span></div>';
          html += '<div class="stat"><span>Uptime</span><span>'+health.uptime+'s</span></div>';
        }
        if (metrics) {
          html += '<h2>Metrics</h2>';
          html += '<div class="stat"><span>Requests</span><span>'+metrics.requests+'</span></div>';
          html += '<div class="stat"><span>Errors</span><span>'+metrics.serverErrors+'</span></div>';
        }
        if (routes && routes.routes.length) {
          html += '<h2>Routes ('+routes.routes.length+')</h2>';
          html += '<table><tr><th>Method</th><th>Path</th><th>Handler</th></tr>';
          routes.routes.forEach(r => {
            html += '<tr><td>'+r.method+'</td><td>'+r.path+'</td><td>'+r.controller+'.'+r.handler+'</td></tr>';
          });
          html += '</table>';
        }
        if (container) {
          html += '<h2>DI Container ('+container.count+')</h2>';
        }
        document.getElementById('content').innerHTML = html || 'No data';
      } catch { document.getElementById('content').textContent = 'Cannot connect to ' + BASE; }
    }
    load();
    setInterval(load, 30000);
  </script>
</body>
</html>`
  }
}
