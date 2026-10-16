---
'@forinda/kickjs-inertia': patch
'@forinda/kickjs-cli': patch
---

Inertia template and adapter fixes:

- `InertiaAdapter` renders without a client build under `NODE_ENV` development or test (no asset tags, no asset version, one warning), so `createTestApp` works on a fresh clone; production — and an unset `NODE_ENV` — still fails at startup without the manifest.
- `InertiaAdapterOptions` marks the defaulted `entry`, `clientDir` and `title` optional.
- The default HTML shell leaves out its `<title>` when the head already has one (a server-rendered `<Head>`), so the page has a single title.
- `kick new --template inertia` declares `SESSION_SECRET` in the env schema — required in production, a dev-only default elsewhere — and reads it with `getEnv`, instead of throwing in `src/index.ts` when it is unset. The project ships a pages test that runs before the client is built.
- `kick new --yes` without `--pm` uses the package manager that launched it (`pnpm dlx`, `yarn dlx`, `bunx`) when no project config, `packageManager` field or lockfile decides.
- The generated Dockerfile prepares a writable `/app/data` for a volume (a SQLite file, uploads) and says so.
