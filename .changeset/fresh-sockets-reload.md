---
'@forinda/kickjs-ws': patch
---

WebSocket connections no longer answer 503 after a dev hot reload.

On reload, `bootstrap()` shuts the old app down with `closeServer: false` and
starts a fresh one on the same HTTP server. `WsAdapter.shutdown()` closed its
`WebSocketServer` but left its `'upgrade'` listener on the server. That listener
ran before the new adapter's, matched the path, and handed the upgrade to the
closed server — which `ws` answers with 503 — so every WebSocket failed until the
dev server was restarted, and each save added another dead listener.
`shutdown()` now removes the listener.

`SocketIoAdapter` had the same shape: engine.io's `attach()` adds upgrade, close
and listening listeners and wraps the server's own request listeners, and
shutdown undid none of it. It now removes what `attach()` added and restores the
request listeners it wrapped, so a reload leaves the server as it found it.
