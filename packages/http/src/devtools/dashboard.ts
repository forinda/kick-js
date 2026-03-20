/**
 * Generates the self-contained HTML dashboard for DevTools.
 * Served at GET /_debug — dark-themed, auto-refreshes every 30s.
 */
export function renderDashboard(basePath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KickJS DevTools</title>
<style>
${CSS}
</style>
</head>
<body>
${BODY}
<script>
const BASE = '${basePath}';
const POLL_MS = 30000;
${SCRIPT}
</script>
</body>
</html>`
}

// ── Styles ──────────────────────────────────────────────────────────────

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 8px; color: #38bdf8; }
  .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
  .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 12px; }
  .stat { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #334155; }
  .stat:last-child { border-bottom: none; }
  .stat-label { color: #94a3b8; }
  .stat-value { font-weight: 600; font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-green { background: #065f46; color: #6ee7b7; }
  .badge-red { background: #7f1d1d; color: #fca5a5; }
  .badge-blue { background: #1e3a5f; color: #93c5fd; }
  .badge-yellow { background: #713f12; color: #fcd34d; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px; color: #94a3b8; border-bottom: 2px solid #334155; font-weight: 600; }
  td { padding: 8px; border-bottom: 1px solid #1e293b; }
  .method { font-weight: 700; font-size: 11px; }
  .method-get { color: #34d399; }
  .method-post { color: #60a5fa; }
  .method-put { color: #fbbf24; }
  .method-delete { color: #f87171; }
  .method-patch { color: #a78bfa; }
  .refresh-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .refresh-info { font-size: 12px; color: #64748b; }
  .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34d399; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .empty { color: #64748b; font-style: italic; padding: 12px 0; }
`

// ── HTML Body ───────────────────────────────────────────────────────────

const BODY = `
<h1>⚡ KickJS DevTools</h1>
<div class="refresh-bar">
  <div class="subtitle">Development introspection dashboard</div>
  <div class="refresh-info"><span class="pulse"></span>Auto-refresh every 30s · <span id="lastUpdate">loading...</span></div>
</div>

<div class="grid">
  <div class="card">
    <h2>Health</h2>
    <div id="health"><div class="empty">Loading...</div></div>
  </div>
  <div class="card">
    <h2>Metrics</h2>
    <div id="metrics"><div class="empty">Loading...</div></div>
  </div>
  <div class="card">
    <h2>WebSocket</h2>
    <div id="ws"><div class="empty">Loading...</div></div>
  </div>
</div>

<div class="card" style="margin-bottom: 16px;">
  <h2>Routes (<span id="routeCount">0</span>)</h2>
  <div id="routes" style="overflow-x: auto;"><div class="empty">Loading...</div></div>
</div>

<div class="card">
  <h2>DI Container (<span id="diCount">0</span>)</h2>
  <div id="container" style="overflow-x: auto;"><div class="empty">Loading...</div></div>
</div>
`

// ── Client-side Script ──────────────────────────────────────────────────

const SCRIPT = `
async function fetchJSON(path) {
  try { const r = await fetch(BASE + path); return r.ok ? r.json() : null; } catch { return null; }
}

function stat(label, value) {
  return '<div class="stat"><span class="stat-label">' + label + '</span><span class="stat-value">' + value + '</span></div>';
}

function badge(text, type) {
  return '<span class="badge badge-' + type + '">' + text + '</span>';
}

function methodClass(m) { return 'method method-' + m.toLowerCase(); }

async function refresh() {
  const [health, metrics, routes, container, ws] = await Promise.all([
    fetchJSON('/health'), fetchJSON('/metrics'), fetchJSON('/routes'),
    fetchJSON('/container'), fetchJSON('/ws'),
  ]);

  if (health) {
    const statusBadge = health.status === 'healthy' ? badge('healthy', 'green') : badge('degraded', 'red');
    let html = stat('Status', statusBadge);
    html += stat('Uptime', formatDuration(health.uptime));
    html += stat('Error Rate', (health.errorRate * 100).toFixed(2) + '%');
    if (health.adapters) {
      Object.entries(health.adapters).forEach(function(e) {
        html += stat(e[0], badge(e[1], e[1] === 'running' ? 'green' : 'yellow'));
      });
    }
    document.getElementById('health').innerHTML = html;
  }

  if (metrics) {
    let html = stat('Total Requests', metrics.requests.toLocaleString());
    html += stat('Server Errors (5xx)', metrics.serverErrors);
    html += stat('Client Errors (4xx)', metrics.clientErrors);
    html += stat('Error Rate', (metrics.errorRate * 100).toFixed(2) + '%');
    html += stat('Uptime', formatDuration(metrics.uptimeSeconds));
    html += stat('Started', new Date(metrics.startedAt).toLocaleTimeString());
    document.getElementById('metrics').innerHTML = html;
  }

  if (ws) {
    if (!ws.enabled) {
      document.getElementById('ws').innerHTML = '<div class="empty">No WsAdapter</div>';
    } else {
      let html = stat('Active Connections', ws.activeConnections);
      html += stat('Total Connections', ws.totalConnections);
      html += stat('Messages In', ws.messagesReceived);
      html += stat('Messages Out', ws.messagesSent);
      html += stat('Errors', ws.errors);
      if (ws.namespaces) {
        Object.entries(ws.namespaces).forEach(function(e) {
          html += stat(e[0], e[1].connections + ' conn / ' + e[1].handlers + ' handlers');
        });
      }
      document.getElementById('ws').innerHTML = html;
    }
  }

  if (routes) {
    document.getElementById('routeCount').textContent = routes.routes.length;
    if (routes.routes.length === 0) {
      document.getElementById('routes').innerHTML = '<div class="empty">No routes registered</div>';
    } else {
      let html = '<table><tr><th>Method</th><th>Path</th><th>Controller</th><th>Handler</th><th>Middleware</th></tr>';
      routes.routes.forEach(function(r) {
        html += '<tr><td class="' + methodClass(r.method) + '">' + r.method + '</td>';
        html += '<td><code>' + r.path + '</code></td>';
        html += '<td>' + r.controller + '</td>';
        html += '<td>' + r.handler + '</td>';
        html += '<td>' + (r.middleware.length ? r.middleware.join(', ') : '—') + '</td></tr>';
      });
      html += '</table>';
      document.getElementById('routes').innerHTML = html;
    }
  }

  if (container) {
    document.getElementById('diCount').textContent = container.count;
    if (container.count === 0) {
      document.getElementById('container').innerHTML = '<div class="empty">No DI registrations</div>';
    } else {
      let html = '<table><tr><th>Token</th><th>Scope</th><th>Instantiated</th></tr>';
      container.registrations.forEach(function(r) {
        html += '<tr><td><code>' + r.token + '</code></td>';
        html += '<td>' + badge(r.scope, 'blue') + '</td>';
        html += '<td>' + (r.instantiated ? badge('yes', 'green') : badge('no', 'yellow')) + '</td></tr>';
      });
      html += '</table>';
      document.getElementById('container').innerHTML = html;
    }
  }

  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  return h + 'h ' + m + 'm';
}

refresh();
setInterval(refresh, POLL_MS);
`
