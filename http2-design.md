# HTTP/2 (+ TLS) in the production server — roadmap Q.3

> Status: **implemented** — decisions: build the full option; Express +
> `http2` is a boot error (KICK007); HTTP/3 deferred; no h2c. Guide:
> `docs/guide/http-runtimes.md#https-and-http-2`. The h3 body fix shipped
> separately (#751). Deviation from the proposal below: no `kick doctor`
> check — the boot error already fires before setup, with the same fix text.

## Where we are

- The production path always does `http.createServer(runtime.nodeHandler(app))`
  (`packages/kickjs/src/http/application.ts`). There is **no HTTPS option at all**.
- Dev mode is Vite's server; this design does not touch it.
- Browsers only speak HTTP/2 over TLS (`h2`). Cleartext HTTP/2 (`h2c`) is for
  proxies and gRPC. So in practice this feature is "TLS, optionally with HTTP/2".

## What each engine does behind `node:http2` (measured)

Each runtime's `nodeHandler` behind `http2.createServer` (h2c), driven by a
`node:http2` client — `GET` with a query, `POST` JSON, `ctx.sse()`, and a 404:

| Engine  | GET                                                                                         | POST body      | SSE   | 404                  |
| ------- | ------------------------------------------------------------------------------------------- | -------------- | ----- | -------------------- |
| Express | hangs; `TypeError: Cannot read properties of undefined (reading 'readable')` inside Express | hangs          | hangs | hangs                |
| Fastify | ok                                                                                          | ok             | ok    | ok (problem details) |
| h3      | ok                                                                                          | **empty `{}`** | ok    | ok                   |

- **Express 5 cannot run on Node's HTTP/2 compat layer.** The crash is inside
  Express, before our code runs. The usual explanation (not verified here) is
  that Express swaps `req`/`res` prototypes for ones built on
  `http.IncomingMessage` / `ServerResponse`, which `Http2ServerRequest` /
  `Http2ServerResponse` are not. Either way it is not ours to shim.
- **h3 drops HTTP/2 bodies** — root cause is ours:
  `runtimes/h3.ts` decides "was a body sent" from `content-length` /
  `transfer-encoding`. HTTP/2 has no `transfer-encoding` and `content-length`
  is optional, so a streamed HTTP/2 body is treated as absent. Fix: on
  `httpVersionMajor === 2`, treat the body as present unless
  `content-length: 0`.

## WebSockets

`ws` (the ws adapter, the devtools bus) attaches to the server's `upgrade`
event. `http2.createSecureServer({ allowHTTP1: true })` **still fires
`upgrade` for HTTP/1.1 clients** (measured: client got `101`, server
`upgrade` fired, HTTP/1.1 requests served as `1.1`). So WebSockets keep
working — over the HTTP/1.1 fallback, which is what browsers use for `ws://`
anyway (RFC 8441 WebSockets-over-h2 is out of scope). Only verified on Node 24;
check Node 20 (our minimum) before shipping.

## Proposal

```ts
bootstrap({
  modules,
  runtime: fastifyRuntime(),
  server: {
    tls: { key: readFileSync('key.pem'), cert: readFileSync('cert.pem') }, // tls.SecureContextOptions
    http2: true, // requires tls; serves HTTP/2 via ALPN, HTTP/1.1 fallback kept
  },
})
```

| `server`               | Node server                                                       | Engines     |
| ---------------------- | ----------------------------------------------------------------- | ----------- |
| omitted                | `http.createServer` (today)                                       | all         |
| `{ tls }`              | `https.createServer(tls, handler)`                                | all         |
| `{ tls, http2: true }` | `http2.createSecureServer({ ...tls, allowHTTP1: true }, handler)` | Fastify, h3 |

- **Express + `http2: true` fails at boot** with a `KickError` (new code) whose
  fix names the options: switch to `fastifyRuntime()` / `h3Runtime()`, drop
  `http2`, or terminate HTTP/2 at the proxy. Driven by a new
  `RuntimeCapabilities.http2` flag, so the check is not an engine-name `if`.
- **`http2` without `tls` fails at boot** — no h2c until someone needs it
  (gRPC is the likely one; see below).
- `AdapterContext.server` is typed `http.Server` today; with `http2` it is an
  `Http2SecureServer`. Widen the type to a union — a type change adapter
  authors will see, so it goes in the changeset.
- `kick doctor`: add a check that warns on `http2: true` + Express before boot.

## Out of scope

- **HTTP/3.** Node has no stable QUIC (`node:quic` is experimental and behind
  a flag). Mark Q.3's HTTP/3 half `deferred` until it is stable.
- **h2c (cleartext HTTP/2).** Only needed behind a proxy or for native gRPC.
  `@forinda/kickjs-grpc` serves Connect / gRPC-Web, which work over HTTP/1.1.
- **Dev mode** (Vite owns the server).

## Worth asking first

Most production deploys terminate TLS and HTTP/2 at a proxy or platform
(nginx, Caddy, Cloudflare, a load balancer, Vercel/Netlify) and talk HTTP/1.1
to the app — for them this changes nothing. It matters for apps that are
exposed directly (a VM, a container with no ingress, local HTTPS for
cookie/`Secure` testing). The h3 body fix is worth doing regardless: it is a
correctness bug for anyone already running h3 behind HTTP/2 via their own
server.

## Decisions needed

1. Build the `server: { tls, http2 }` option at all, or document "terminate at
   the proxy" and ship only the h3 fix?
2. If building: Express + `http2` as a boot error (proposed), or a silent
   fallback to HTTPS/1.1?
3. HTTP/3 → `deferred` in the roadmap, h2c → not now. Agree?

## Estimate

- h3 HTTP/2 body fix + cross-runtime h2 test: ½ day.
- `server` option, capability flag, KickError, type widening, doctor check,
  tests on all engines, docs: 2–3 days.
