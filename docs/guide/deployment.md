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

```bash
pnpm install
pnpm build
NODE_ENV=production node dist/index.js
```

`pnpm build` builds what the template needs: the server bundle, and for an Inertia app the pages and the server-rendering bundle too. A fullstack workspace builds both packages from its root and starts from `server/`:

```bash
pnpm build
cd server && NODE_ENV=production node dist/index.js
```

Start the server with `node`, not `kick start`. The CLI is a dev dependency, so it is not there after a production install (`pnpm install --prod`).

What the server reads from the environment:

| Variable         | Needed by       | Notes                                                          |
| ---------------- | --------------- | -------------------------------------------------------------- |
| `PORT`           | every app       | default `3000`                                                 |
| `NODE_ENV`       | every app       | `production`: secure cookies, generic 5xx messages             |
| `SESSION_SECRET` | Inertia apps    | the app refuses to start without it; a long random string      |
| your own keys    | your env schema | validated at startup — see [Configuration](./configuration.md) |

`.env` files are for development; on a host, set the variables in its dashboard or service file.

## Docker

The `Dockerfile` `kick new` writes matches the project's template and package manager (pnpm, npm, yarn or bun):

```bash
docker build -t my-app .
docker run -p 3000:3000 -e SESSION_SECRET=… my-app
```

It builds in three stages:

1. **Production dependencies**, installed from the lockfile.
2. **The build**, with every dependency: `pnpm build` (or the project's package manager) — for an Inertia app that includes the pages and the server-rendering bundle; for a fullstack workspace, both the server and the web app.
3. **The runtime**: `node:22-slim` with the production dependencies and the build output, running `node dist/index.js` as the unprivileged `node` user on port 3000.

Two things the build expects:

- **A committed lockfile.** Installs are frozen, so the image gets exactly the versions you tested. Run your package manager's install once before building.
- **The same package manager version.** `package.json`'s `packageManager` field records the one the project was created with, and corepack installs that version in the image — a different major can read the lockfile differently.

`.dockerignore` keeps `node_modules`, build output and every `.env` file out of the build context: the image never contains secrets. Pass them with `-e`, `--env-file` or your platform's settings.

A fullstack image serves the built web app from the server, as `kick start` does locally — one container, one port.

## Running more than one instance

Several containers behind a load balancer, or functions that start a new instance per request, do not share memory. Whatever lives in it is per instance:

- **Sessions** — the default store is in memory. Use `session({ secret, store: 'cookie' })`, which keeps the data in an encrypted cookie, or a shared store. The Inertia template uses the cookie store, so its validation errors and flash messages survive any number of instances. See [Sessions](./sessions.md#cookie-store).
- **Rate limits** — use a shared store, see [Rate Limiting](./rate-limiting.md).
- **Data** — the scaffolds' in-memory repositories are examples; use a database.

Behind a proxy or load balancer, set `bootstrap({ trustProxy })` so `ctx.ip` and rate limits see the client's address instead of the proxy's — see [the option](../api/core.md).

## Netlify and Vercel

```bash
pnpm run build:netlify   # → .netlify/
pnpm run build:vercel    # → .vercel/output
```

Both build the app as a function from `src/serverless.ts`, which serves the same app `src/index.ts` describes. The platform serves the static files — a fullstack web app, an Inertia app's built pages and assets — and the function answers the rest. Everything about the two platforms is in [Serverless](./serverless.md).
