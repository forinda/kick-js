import * as vscode from 'vscode'

/**
 * A string as a JS literal that is safe inside an HTML `<script>` element.
 * `JSON.stringify` alone isn't: a value containing `</script>` would end the
 * element before the string does, so `<` is escaped as `\u003c` too.
 */
export function scriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []

  private constructor(
    panel: vscode.WebviewPanel,
    private baseUrl: string,
    private token: string | undefined,
  ) {
    this.panel = panel
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.panel.webview.html = this.getHtml()
  }

  public static createOrShow(extensionUri: vscode.Uri, baseUrl: string, token?: string) {
    if (DashboardPanel.currentPanel) {
      // Refresh the base URL + token on the live panel so a token set/clear
      // (or a reconnect to a different app) takes effect without closing it.
      DashboardPanel.currentPanel.update(baseUrl, token)
      DashboardPanel.currentPanel.panel.reveal()
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'kickjsDashboard',
      'KickJS DevTools',
      vscode.ViewColumn.One,
      { enableScripts: true },
    )

    DashboardPanel.currentPanel = new DashboardPanel(panel, baseUrl, token)
  }

  /** Re-point the open panel at a new base URL / token and re-render. */
  private update(baseUrl: string, token: string | undefined): void {
    if (this.baseUrl === baseUrl && this.token === token) return
    this.baseUrl = baseUrl
    this.token = token
    this.panel.webview.html = this.getHtml()
  }

  private dispose() {
    DashboardPanel.currentPanel = undefined
    this.panel.dispose()
    for (const d of this.disposables) d.dispose()
  }

  private getHtml(): string {
    // Note: This webview runs in a sandboxed iframe with no access to
    // the user's filesystem or network beyond what fetch allows. All
    // dynamic content comes from the local KickJS debug API and is
    // escaped via textContent where possible. The innerHTML usage below
    // constructs markup from trusted local API data only.
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 16px; margin: 0; }
    h1 { display: flex; align-items: center; gap: 8px; font-size: 16px; margin: 0 0 16px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--vscode-descriptionForeground); margin: 20px 0 8px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
    .btn { padding: 4px 12px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 3px; cursor: pointer; font-size: 12px; font-family: inherit; }
    .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .stat { display: flex; justify-content: space-between; padding: 4px 0; }
    .stat-label { color: var(--vscode-descriptionForeground); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-weight: 500; }
    td { padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
    .badge { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 500; }
    .ok { background: #065f46; color: #6ee7b7; }
    .err { background: #7f1d1d; color: #fca5a5; }
    .method { font-weight: 600; font-size: 11px; }
    .method-get { color: #4ade80; }
    .method-post { color: #22d3ee; }
    .method-put, .method-patch { color: #fbbf24; }
    .method-delete { color: #f87171; }
    .search { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 3px; font-size: 12px; font-family: inherit; margin-bottom: 8px; box-sizing: border-box; }
    .search::placeholder { color: var(--vscode-input-placeholderForeground); }
    .dimmed { color: var(--vscode-descriptionForeground); }
    .updated { font-size: 11px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>KickJS DevTools</h1>
  <div class="toolbar">
    <button class="btn" id="refreshBtn">Refresh</button>
    <span class="updated" id="updated"></span>
  </div>
  <div id="content"></div>
  <script>
    const BASE = ${scriptString(this.baseUrl)};
    const TOKEN = ${scriptString(this.token ?? '')};
    let allRoutes = [];

    // Authenticated GET — sends the devtools token as a header (not a
    // query string), matching the tree providers. Without this the
    // dashboard 401s against any server with a configured secret.
    // /health answers 503 when degraded — that body is still the status.
    function getJson(path) {
      const headers = TOKEN ? { 'x-devtools-token': TOKEN } : undefined;
      return fetch(BASE + path, { headers })
        .then(r => (r.ok || (path === '/health' && r.status === 503)) ? r.json() : null)
        .catch(() => null);
    }

    // Escape HTML entities in dynamic string values
    function esc(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    function filterRoutes(query) {
      if (!query) return allRoutes;
      const q = query.toLowerCase();
      return allRoutes.filter(r =>
        r.method.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        (r.controller + '.' + r.handler).toLowerCase().includes(q)
      );
    }

    function buildRouteTable(routes) {
      const table = document.createElement('table');
      const thead = document.createElement('tr');
      ['Method', 'Path', 'Handler'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        thead.appendChild(th);
      });
      table.appendChild(thead);
      routes.forEach(r => {
        const tr = document.createElement('tr');
        const tdMethod = document.createElement('td');
        tdMethod.className = 'method method-' + r.method.toLowerCase();
        tdMethod.textContent = r.method;
        const tdPath = document.createElement('td');
        tdPath.textContent = r.path;
        const tdHandler = document.createElement('td');
        tdHandler.className = 'dimmed';
        tdHandler.textContent = r.controller + '.' + r.handler;
        tr.appendChild(tdMethod);
        tr.appendChild(tdPath);
        tr.appendChild(tdHandler);
        table.appendChild(tr);
      });
      return table;
    }

    function buildStatRow(label, value) {
      const div = document.createElement('div');
      div.className = 'stat';
      const spanLabel = document.createElement('span');
      spanLabel.className = 'stat-label';
      spanLabel.textContent = label;
      const spanValue = document.createElement('span');
      spanValue.textContent = String(value);
      div.appendChild(spanLabel);
      div.appendChild(spanValue);
      return div;
    }

    function mb(bytes) {
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    /** A titled card of label/value rows; rows with an undefined value are skipped. */
    function buildCard(title, rows) {
      const card = document.createElement('div');
      card.className = 'card';
      const h = document.createElement('h2');
      h.textContent = title;
      card.appendChild(h);
      rows.forEach(([label, value]) => {
        if (value !== undefined && value !== null) card.appendChild(buildStatRow(label, value));
      });
      return card;
    }

    function buildQueueTable(queues) {
      const table = document.createElement('table');
      const head = document.createElement('tr');
      ['Queue', 'Waiting', 'Active', 'Delayed', 'Failed', 'Completed'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        head.appendChild(th);
      });
      table.appendChild(head);
      queues.forEach(q => {
        const tr = document.createElement('tr');
        [q.name, q.waiting, q.active, q.delayed, q.failed, q.completed].forEach(v => {
          const td = document.createElement('td');
          td.textContent = v === undefined ? '—' : String(v);
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      return table;
    }

    function buildBadge(text, ok) {
      const span = document.createElement('span');
      span.className = 'badge ' + (ok ? 'ok' : 'err');
      span.textContent = text;
      return span;
    }

    async function load() {
      const content = document.getElementById('content');
      try {
        const [health, metrics, routes, container, runtime, topology, graph, queues, ws] =
          await Promise.all([
            getJson('/health'),
            getJson('/metrics'),
            getJson('/routes'),
            getJson('/container'),
            getJson('/runtime'),
            getJson('/topology'),
            getJson('/graph'),
            getJson('/queues'),
            getJson('/ws'),
          ]);

        allRoutes = routes?.routes ?? [];
        content.replaceChildren();

        // Grid for health + metrics
        const grid = document.createElement('div');
        grid.className = 'grid';

        // Health card
        const healthCard = document.createElement('div');
        healthCard.className = 'card';
        const healthTitle = document.createElement('h2');
        healthTitle.textContent = 'Health';
        healthCard.appendChild(healthTitle);
        if (health) {
          const statusRow = document.createElement('div');
          statusRow.className = 'stat';
          const statusLabel = document.createElement('span');
          statusLabel.className = 'stat-label';
          statusLabel.textContent = 'Status';
          statusRow.appendChild(statusLabel);
          statusRow.appendChild(buildBadge(health.status, health.status === 'healthy'));
          healthCard.appendChild(statusRow);
          healthCard.appendChild(buildStatRow('Uptime', health.uptime + 's'));
          if (health.runtime && health.runtime.name) {
            healthCard.appendChild(buildStatRow('Runtime', health.runtime.name));
          }
        } else {
          const p = document.createElement('p');
          p.className = 'dimmed';
          p.textContent = 'Unavailable';
          healthCard.appendChild(p);
        }
        grid.appendChild(healthCard);

        // Metrics card
        const metricsCard = document.createElement('div');
        metricsCard.className = 'card';
        const metricsTitle = document.createElement('h2');
        metricsTitle.textContent = 'Metrics';
        metricsCard.appendChild(metricsTitle);
        if (metrics) {
          metricsCard.appendChild(buildStatRow('Requests', metrics.requests));
          metricsCard.appendChild(buildStatRow('Server Errors', metrics.serverErrors));
          const rate = ((metrics.errorRate ?? 0) * 100).toFixed(1);
          metricsCard.appendChild(buildStatRow('Error Rate', rate + '%'));
        } else {
          const p = document.createElement('p');
          p.className = 'dimmed';
          p.textContent = 'Unavailable';
          metricsCard.appendChild(p);
        }
        grid.appendChild(metricsCard);

        // Runtime card — /runtime is 404 when the sampler is off, so the card
        // only appears when there is something to show.
        if (runtime && runtime.latest) {
          const p = runtime.process || {};
          const m = runtime.latest.memory || {};
          const loop = runtime.latest.eventLoop || {};
          const card = buildCard('Runtime', [
            ['Engine', p.runtime && p.runtime.name],
            ['Node', p.nodeVersion && (p.nodeVersion + ' · pid ' + p.pid)],
            ['Heap', m.heapUsed !== undefined ? mb(m.heapUsed) + ' / ' + mb(m.heapTotal) : undefined],
            ['RSS', m.rss !== undefined ? mb(m.rss) : undefined],
            ['Event loop p99', loop.p99 !== undefined ? loop.p99.toFixed(1) + ' ms' : undefined],
          ]);
          const severity = runtime.health && runtime.health.heapGrowthSeverity;
          if (severity) {
            const row = document.createElement('div');
            row.className = 'stat';
            const label = document.createElement('span');
            label.className = 'stat-label';
            label.textContent = 'Heap growth';
            row.appendChild(label);
            row.appendChild(buildBadge(severity, severity === 'ok'));
            card.appendChild(row);
          }
          grid.appendChild(card);
        }

        if (topology) {
          const names = (list) => (list || []).map(x => x.name).join(', ') || 'none';
          grid.appendChild(buildCard('Topology', [
            ['Adapters', names(topology.adapters)],
            ['Plugins', names(topology.plugins)],
            ['Contributors', (topology.contributors || []).length],
            ['DI tokens', (topology.diTokens || []).length],
            ['Introspection errors', (topology.errors || []).length || undefined],
          ]));
        }

        if (ws && ws.enabled) {
          grid.appendChild(buildCard('WebSockets', [
            ['Active connections', ws.activeConnections],
            ['Total connections', ws.totalConnections],
            ['Messages in / out', ws.messagesReceived + ' / ' + ws.messagesSent],
            ['Errors', ws.errors],
          ]));
        }

        content.appendChild(grid);

        if (queues && queues.enabled) {
          const title = document.createElement('h2');
          title.textContent = 'Queues (' + (queues.queues || []).length + ')';
          content.appendChild(title);
          if (queues.error) {
            const p = document.createElement('p');
            p.className = 'dimmed';
            p.textContent = queues.error;
            content.appendChild(p);
          }
          content.appendChild(buildQueueTable(queues.queues || []));
        }

        // Routes with search
        if (allRoutes.length) {
          const routesTitle = document.createElement('h2');
          routesTitle.textContent = 'Routes (' + allRoutes.length + ')';
          content.appendChild(routesTitle);

          const search = document.createElement('input');
          search.className = 'search';
          search.placeholder = 'Filter routes (method, path, handler)...';
          const routeContainer = document.createElement('div');
          routeContainer.appendChild(buildRouteTable(allRoutes));
          search.addEventListener('input', () => {
            routeContainer.replaceChildren(buildRouteTable(filterRoutes(search.value)));
          });
          content.appendChild(search);
          content.appendChild(routeContainer);
        }

        // Container
        if (container) {
          const containerTitle = document.createElement('h2');
          containerTitle.textContent = 'DI Container (' + container.count + ' registrations)';
          content.appendChild(containerTitle);
          if (graph) {
            const p = document.createElement('p');
            p.className = 'dimmed';
            p.textContent =
              'Dependency graph: ' + graph.nodes.length + ' nodes, ' + graph.edges.length + ' edges';
            content.appendChild(p);
          }
        }

        document.getElementById('updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
      } catch {
        content.replaceChildren();
        const p = document.createElement('p');
        p.className = 'dimmed';
        p.textContent = 'Cannot connect to ' + BASE;
        content.appendChild(p);
        document.getElementById('updated').textContent = '';
      }
    }

    document.getElementById('refreshBtn').addEventListener('click', load);
    load();
    setInterval(load, 30000);
  </script>
</body>
</html>`
  }
}
