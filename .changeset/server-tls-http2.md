---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': patch
---

`bootstrap({ server: { tls, http2 } })`: serve HTTPS, and optionally HTTP/2, from the production server.

- `{ tls }` serves HTTPS on every runtime (`https.createServer`).
- `{ tls, http2: true }` serves HTTP/2 with HTTP/1.1 fallback (`http2.createSecureServer` with `allowHTTP1: true`) on Fastify and h3. HTTP/1.1 clients and WebSocket handshakes keep working on the same port.
- `http2: true` on the Express runtime fails at boot with **KICK007**, because Express does not run on Node's HTTP/2 compatibility layer. `http2` without `tls` fails with **KICK008**. Both checks run before `setup()`.
- `RuntimeCapabilities` gains an optional `http2` flag. Custom runtimes opt in; if it's absent, the runtime is treated as not supporting HTTP/2.
- The option is ignored in dev mode, where Vite owns the server, with a warning.

**Type change:** `AdapterContext.server` and `Application.getHttpServer()` are now typed `KickServer` (`http.Server | https.Server | http2.Http2SecureServer`, exported) instead of `http.Server`. Adapters that only attach to `upgrade` or read `address()` need no change. Code that relies on `http.Server`-only members must narrow the type first.

`@forinda/kickjs-devtools`: the WebSocket bus accepts any `KickServer`.
