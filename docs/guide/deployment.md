# Deploying

A KickJS app runs as a **long-running Node server** — on any host that runs Node, or in a container — or as a **function** on Netlify or Vercel. Every project `kick new` creates is ready for all three:

| Target                  | What runs                       | Files `kick new` writes                  | Guide                                   |
| ----------------------- | ------------------------------- | ---------------------------------------- | --------------------------------------- |
| A Node host             | `node dist/index.js`            | —                                        | [below](#a-node-host)                   |
| Docker                  | the same server, in an image    | `Dockerfile`, `.dockerignore`            | [below](#docker)                        |
| Netlify, Vercel         | a function, `src/serverless.ts` | `netlify.toml`, `vercel.json`, the entry | [Serverless](./serverless.md)           |
| Cloudflare Workers, Bun | the web entry                   | —                                        | [Edge Deployment](./edge-deployment.md) |

It works the same for every template — REST or minimal APIs, [Inertia](./inertia.md) apps and fullstack workspaces.

## A Node host

<PmCommand install run="build" />

```bash
NODE_ENV=production node dist/index.js
```

The `build` script builds what the template needs: the server bundle, and for an Inertia app the pages and the server-rendering bundle too. A fullstack workspace builds both packages from its root and starts from `server/`:

<PmCommand run="build" />

```bash
cd server && NODE_ENV=production node dist/index.js
```

Start the server with `node`, not `kick start`. The CLI is a dev dependency, so it is not there after a production install (`npm ci --omit=dev`, `pnpm install --prod`).

What the server reads from the environment:

| Variable         | Needed by       | Notes                                                          |
| ---------------- | --------------- | -------------------------------------------------------------- |
| `PORT`           | every app       | default `3000`                                                 |
| `NODE_ENV`       | every app       | unset counts as `production`: secure cookies, opaque 5xx       |
| `SESSION_SECRET` | Inertia apps    | the app refuses to start without it; a long random string      |
| `APP_URL`        | Inertia apps    | the site's public URL — canonical links, sitemap; required     |
| your own keys    | your env schema | validated at startup — see [Configuration](./configuration.md) |

`.env` files are for development; on a host, set the variables in its dashboard or service file.

## Docker

`kick g deploy docker` (or `kick new --deploy docker`) writes a `Dockerfile` and `.dockerignore` that match the project's template and package manager (pnpm, npm, yarn or bun):

```bash
docker build -t my-app .
docker run -p 3000:3000 -e SESSION_SECRET=… -e APP_URL=https://… my-app
```

It builds in three stages:

1. **Production dependencies**, installed from the lockfile.
2. **The build**, with every dependency: the `build` script, run with the project's package manager — for an Inertia app that includes the pages and the server-rendering bundle; for a fullstack workspace, both the server and the web app.
3. **The runtime**: `node:22-slim` with the production dependencies and the build output, running `node dist/index.js` as the unprivileged `node` user on port 3000.

Two things the build expects:

- **A committed lockfile.** Installs are frozen, so the image gets exactly the versions you tested. Run your package manager's install once before building.
- **The same package manager version.** `package.json`'s `packageManager` field records the one the project was created with, and corepack installs that version in the image — a different major can read the lockfile differently.

`.dockerignore` keeps `node_modules`, build output and every `.env` file out of the build context: the image never contains secrets. Pass them with `-e`, `--env-file` or your platform's settings.

The install stages carry `python3`, `make` and `g++`, so a native addon with no prebuilt binary for the image — `better-sqlite3` after `kick add sqlite`, say — compiles there; the runtime image doesn't get them. The production install sets `PRISMA_SKIP_POSTINSTALL_GENERATE=1`: it has no Prisma CLI (a dev dependency), so `@prisma/client`'s postinstall would fail it. Generate the client in your `build` script (`prisma generate && kick build`); a client generated into `node_modules/.prisma` (in a fullstack workspace, also `server/node_modules/.prisma`) is copied into the runtime from the build stage.

A fullstack image serves the built web app from the server, as `kick start` does locally — one container, one port.

## Running more than one instance

Several containers behind a load balancer, or functions that start a new instance per request, do not share memory. Whatever lives in it is per instance:

- **Sessions** — the default store is in memory. Use `session({ secret, store: 'cookie' })`, which keeps the data in an encrypted cookie, or a shared store. The Inertia template uses the cookie store, so its validation errors and flash messages survive any number of instances. See [Sessions](./sessions.md#cookie-store).
- **Rate limits** — use a shared store, see [Rate Limiting](./rate-limiting.md).
- **Data** — the scaffolds' in-memory repositories are examples; use a database.

Behind a proxy or load balancer, set `bootstrap({ trustProxy })` so `ctx.ip` and rate limits see the client's address instead of the proxy's — see [the option](../api/core.md).

## Behind a load balancer or on Kubernetes

- **Probes:** point the liveness probe at `/health/live` and the readiness probe at `/health/ready`. During shutdown readiness answers `503` and liveness stays `200`, so the instance leaves rotation without being restarted. Readiness runs every adapter's `onHealthCheck()` with a 2-second timeout each (`health: { checkTimeout }`).
- **Shutdown:** set `preStopDelay` to a few seconds (for example `5_000`). The app keeps serving while balancers and Kubernetes endpoints notice it is unready, then stops accepting connections and drains. Draining and the adapters' shutdown hooks each get up to `shutdownTimeout`, so keep the platform's grace period (`terminationGracePeriodSeconds`) above `preStopDelay` plus twice `shutdownTimeout`, with a few seconds to spare — with the defaults and `preStopDelay: 5_000`, at least 70 seconds.
- **Keep-alive:** the server keeps idle connections for 65 seconds, above AWS ALB's 60-second idle timeout. If your balancer's idle timeout is longer, raise `server: { keepAliveTimeout }` above it — otherwise requests on reused connections fail with 502.

### A management port

`management: { port }` serves health checks, metrics and DevTools on a second port, so the public port carries only your API — like Spring Boot's `management.server.port`:

```ts
bootstrap({
  modules,
  management: { port: 9090 },
  adapters: [
    metricsAdapter({ management: true }),
    DevToolsAdapter({ management: true, enabled: true, secret: getEnv('DEVTOOLS_TOKEN') }),
  ],
})
```

- `/health/live` and `/health/ready` answer on `9090` only. Point the probes there, and expose only the public port through the ingress.
- Your middleware — auth, rate limits, CSRF, the request log — doesn't run on the management port, so probes need no exemptions (`health: { flags }` makes no difference there). Readiness keeps answering `503` while the app shuts down.
- `metricsAdapter({ management: true })` serves `/metrics` there, and `DevToolsAdapter({ management: true })` serves `/_debug`, keeping both off the internet. DevTools still needs `enabled: true` outside development, and a `secret`.
- `host` picks the interface to listen on. The default is all of them, like the public port: a kubelet probes the pod's address, so `127.0.0.1` would fail the probes. Keep the port private with a network policy.
- It's plain HTTP unless you pass `tls` (the same shape as `server.tls`) — set it when anything crossing that network carries a credential, such as the DevTools token.
- The port opens before the app has finished starting; until it has, readiness answers `503` with `status: 'starting'`.
- At startup the log lists what the management port serves, one line per controller or adapter:

  ```
  Management server on http://localhost:9090
    HealthController  GET /health/live, GET /health/ready
    MetricsAdapter    GET /metrics
    DevToolsAdapter   41 routes under /_debug
  ```

  `app.getRoutes()` lists every route with the port it's on (`port: 'app' | 'management'`), adapters' included, and with `logRouteTable: true` the route table marks the management port's.

- Routes on the management port stay out of the OpenAPI spec: Swagger describes the API the public port serves.
- Off by default. In `kick dev` and on serverless platforms everything stays on the one port.

## Metrics

`metricsAdapter()` serves Prometheus metrics at `/metrics`:

```ts
import { metricsAdapter } from '@forinda/kickjs'

bootstrap({
  modules,
  adapters: [metricsAdapter({ token: process.env.METRICS_TOKEN })],
})
```

| Metric                                              | Type      |                                      |
| --------------------------------------------------- | --------- | ------------------------------------ |
| `http_request_duration_seconds`                     | histogram | by `method`, `route` and `status`    |
| `process_resident_memory_bytes`                     | gauge     |                                      |
| `nodejs_heap_used_bytes`, `nodejs_heap_total_bytes` | gauge     |                                      |
| `nodejs_eventloop_lag_seconds`                      | gauge     | mean delay since the previous scrape |
| `process_uptime_seconds`                            | gauge     |                                      |

`route` is the route pattern (`/api/v1/users/:id`), never the raw URL, so one route is one series; requests no route matched share `route="unmatched"`. The scrape itself is not counted.

- **Protect it.** A scraper doesn't need your auth, and your auth doesn't cover the endpoint. Pass `token` and configure the scraper with `authorization: { credentials: … }`, or serve it on the [management port](#a-management-port) with `metricsAdapter({ management: true })`.
- **With `allowedHosts`**, Prometheus scrapes by pod IP: add the path to the allow-list's exemptions — `security: { allowedHosts: { hosts: [...], ignorePaths: ['/metrics'] } }`.
- `metricsAdapter({ path, buckets })` changes the path and the histogram buckets (seconds).

Metrics are per process: run Prometheus against each instance (the usual Kubernetes pod discovery does this).

## Netlify and Vercel

<PmCommand run="build:netlify
build:vercel" />

`build:netlify` writes `.netlify/`, `build:vercel` writes `.vercel/output`.

Both build the app as a function from `src/serverless.ts`, which serves the same app `src/index.ts` describes. The platform serves the static files — a fullstack web app, an Inertia app's built pages and assets — and the function answers the rest. Everything about the two platforms is in [Serverless](./serverless.md).
