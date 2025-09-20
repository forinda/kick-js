# Kick

Opinionated Express + TypeScript framework starter that feels like Spring Boot: decorator-driven controllers, configuration-first bootstrap, and fully instrumented telemetry ready for custom devtools.

## Highlights

- Spring Boot-style controllers via `@Controller`, `@Get`, etc., auto-registered at decoration time
- Nuxt-style, file-system driven controller discovery powered by verb-specific base controllers (`src/domains/app/controllers/users.get.controller.ts` ➜ `GET /users`)
- Batteries-included `kick` CLI for bootstrapping projects, generating controllers, and wiring custom commands
- Domain-first scaffolding with configurable folder layout for controllers, services, and domain logic
- Schema-aware route decorators (Zod/Joi) with duplicate-route protection hashed at bootstrap
- Built-in `BaseController` helper with structured responses, request logging, and `fail()` AppError helpers
- `configureApp` and per-call `config` options for prefixes, health endpoints, logging levels, and telemetry limits
- Request telemetry tracked behind the scenes and exposed via `AppDiagnostics`
- Dependency injection utilities (`@Inject`, `@Injectable`, …) that hide raw Inversify decorators
- `tsup` build pipeline producing CommonJS bundles + type declarations
- GitHub Actions workflow for CI and optional npm publishing

## Install

```bash
npm install @forinda/kickjs
```

## Creating your first service

```ts
// app.ts
import "reflect-metadata";
import type { Request, Response } from "express";
import {
  BaseController,
  Controller,
  Get,
  bootstrap,
  configureApp,
} from "@forinda/kickjs";

configureApp({ prefix: "/api/v1" });

@Controller("/hello")
class HelloController extends BaseController {
  protected controllerId(): string {
    return "HelloController";
  }

  @Get({
    path: "/",
    middlewares: [],
    validate: {},
  })
  handle(req: Request, res: Response) {
    const name = typeof req.query.name === "string" ? req.query.name : "World";
    this.mergeRequestMetadata(res, { greeted: name });
    return this.ok(res, { message: `Hello ${name}` });
  }
}

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  await bootstrap({ port });
  console.log(`Server started on http://localhost:${port}`);
}

main().catch((error) => {
  console.error("Failed to bootstrap application", error);
  process.exitCode = 1;
});

```

`bootstrap` wires Express, the Inversify container, and the request tracker. Controllers extending `BaseController` get ergonomic helpers for responses, structured logging, request metadata annotations, and a `fail()` helper for consistent error payloads. Route decorators accept Zod/Joi schemas for request validation without additional middleware.

## Public API surface

```ts
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  HttpVerbController,
  GetController,
  PostController,
  PutController,
  PatchController,
  DeleteController,
  Inject,
  Injectable,
  Optional,
  MultiInject,
  Named,
  Tagged,
  Unmanaged,
  BaseController,
  discoverControllersFromFilesystem,
  RequestTracker,
  AppDiagnostics,
  TYPES,
  configureApp,
  createApp,
  bootstrap,
  createError,
  AppError,
  isAppError,
  resetControllerRegistry,
  resetAppConfig
} from '@forinda/kickjs';
```

- `Controller`, `Get`, `Post`, `Put`, `Patch`, `Delete`: decorators for routing with built-in schema validation and duplicate-route protection
- `Inject`, `Injectable`, `Optional`, `MultiInject`, `Named`, `Tagged`, `Unmanaged`: DI helpers wrapping Inversify without exposing its API surface
- `HttpVerbController` & the verb-specific subclasses (`GetController`, `PostController`, …): enforce single-verb controllers with shared response/logging helpers and Nuxt-style route derivation
- `BaseController`: abstract class with response + logging helpers for traditional decorator-driven controllers. The request tracker is injected automatically, so subclasses never pass it through `super()`.
- `configureApp(config)`: set global prefix, logging level, telemetry limits, and health endpoint before bootstrapping
- `createApp(options)`: create an Express application with auto-registered controllers (optionally override config per call) and get back a `discovery.controllers` list for diagnostics
- `bootstrap(options)`: create & start the HTTP server (accepts `port`, config overrides, extra middleware)
- `RequestTracker`: injectable request context tracker used internally by `BaseController`
- `AppDiagnostics`: inspect application/request telemetry without touching internal reactive state
- `createError` / `AppError` / `isAppError`: structured error helpers for consistent codes and statuses
- `discoverControllersFromFilesystem(config)`: manually trigger file-system discovery when building custom tooling or CLIs
- `TYPES`: symbol map to wire container bindings
- `resetControllerRegistry()` / `resetAppConfig()`: utilities for clearing global state in integration tests
- `createKickConfig(options)`: compose environment-aware app configuration objects that can be passed to `configureApp` or `createApp`

## File-based controllers

Kick bootstraps controllers automatically by scanning `src/http` (configurable) for files that follow Nuxt-style naming. Each file becomes a single-verb controller by extending the appropriate base class:

```
src/http/
└─ users.get.controller.ts        ➜ GET  /users
└─ users.post.controller.ts       ➜ POST /users
└─ admin/reports.[id].get.controller.ts ➜ GET /admin/reports/:id
```

```ts
// src/http/users.get.controller.ts
import type { Request, Response } from 'express';
import { GetController } from '@forinda/kickjs';

export default class UsersGetController extends GetController {
  handle(_req: Request, res: Response) {
    return this.ok(res, { users: ['Ada', 'Linus'] });
  }
}
```

Naming rules:

- `<segments>.<verb>.controller.(ts|js)` – the last token before `.controller` defines the HTTP method
- Directory names and file segments turn into URL fragments (`[id]` → `:id`, `[...slug]` → `:slug*`, `index` is omitted)
- Set `static route = '/custom/path'` on the class to override the derived path, and `static tags = ['admin']` to enrich diagnostics metadata

Discovery can be customised through `configureApp({ api: { discovery: { ... } } })`:

```ts
configureApp({
  prefix: '/api',
  api: {
    discovery: {
      roots: ['apps/api/http'],
      baseRoute: '/',
      ignore: ['__mocks__']
    }
  }
});
```

Disable discovery (e.g. for legacy decorator-driven projects) with `configureApp({ api: { discovery: { enabled: false } } })` and pass controllers explicitly to `createApp({ controllers: [...] })`.

## CLI

Kick ships with a `kick` executable once the package is installed locally (`npx kick --help`).

### Bootstrapping a project

```bash
npm create kick@latest my-app
cd my-app
npm install
npm run dev
```

The initializer mirrors running `kick init my-app` inside an empty directory: it scaffolds a domain-first folder layout, creates `kick.config.ts` at the repo root for CLI defaults, and generates `src/config/kick.config.ts` for runtime configuration. Both files are plain TypeScript modules you can edit.

During `bootstrap`, load the runtime config and pass it to `configureApp` once before invoking `createApp`/`bootstrap`:

```ts
// src/main.ts
import 'reflect-metadata';
import { bootstrap, configureApp } from '@forinda/kickjs';
import appConfig from './config/kick.config';

configureApp(appConfig);

async function main() {
  const { shutdown } = await bootstrap({ port: process.env.PORT ?? 3000 });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to bootstrap Kick app', error);
  process.exitCode = 1;
});
```

`createKickConfig` handles `.env`, `.env.<NODE_ENV>`, and `.env.local` files automatically, so populating `src/config/kick.config.ts` with env bindings ensures local and production deployments share a single source of truth.

### `kick init [directory]`

Scaffold a fresh project with a minimal `package.json`, `tsconfig.json`, `kick.config.ts`, `src/main.ts`, and a sample domain under `src/domains/app`. Use `--force` to overwrite existing files and `--name` to control the package name.

### `kick generate controller <name>`

Generate a convention-based controller file. The command derives the proper filename and class name, so:

```bash
kick generate controller admin/reports/[id] --method get --tags admin,reports
```

creates `src/domains/admin/controllers/reports.[id].get.controller.ts` when using the default domain layout. Override the discovery root with `--root` when your project stores controllers elsewhere.

### `kick generate domain <name>`

Create a domain folder following your configured layout (defaults to `src/domains/<name>/(controllers|services|domain)`) and, unless `--no-controller` is passed, drop in a starter `index.get.controller.ts` file you can immediately extend.

### Custom commands

Add `kick.config.ts` (or `.js`/`.json`) to declare shorthand commands that proxy to shell steps:

```ts
import type { KickConfig } from '@forinda/kickjs';

const config: KickConfig = {
  structure: {
    domainRoot: 'src/domains',
    domainFolders: ['controllers', 'services', 'domain'],
    defaultDomain: 'app'
  },
  generators: { controllerRoot: 'src/domains/app/controllers' },
  commands: [
    { name: 'dev', description: 'Start the dev server', steps: 'npm run dev' },
    { name: 'lint', steps: ['npm run lint', 'npm run typecheck'] }
  ]
};

export default config;
```

Any command listed becomes available directly, so `kick lint` runs the declared steps. The `structure` block informs both discovery defaults and the CLI generators/initialiser.

## Configuration helper

Use `createKickConfig` to compose application settings that blend defaults, environment variables, and ad-hoc overrides:

```ts
// src/config/kick.config.ts
import { createKickConfig } from '@forinda/kickjs';

export default createKickConfig({
  defaults: {
    prefix: '/api',
    api: {
      discovery: {
        roots: ['src/domains/app/controllers', 'src/http']
      }
    }
  },
  env: {
    KICK_PREFIX: 'prefix',
    KICK_HEALTH: 'healthEndpoint',
    KICK_LOG_LEVEL: { path: 'logging.level' }
  },
  overrides: (current) => ({
    telemetry: {
      trackReactiveHistory: process.env.NODE_ENV !== 'production'
    }
  })
});
```

You can pass the resulting `AppConfig` to `configureApp(config)` during bootstrap or supply it via `createApp({ config })` when composing tests. Environment bindings auto-cast booleans/numbers and accept custom transformers for complex structures.

## Diagnostics & telemetry

`AppDiagnostics` surfaces sanitized snapshots of the framework's internal state so you can build devtools without touching the underlying reactive registry. After creating or bootstrapping the app, read diagnostics straight from the returned context:

```ts
const { diagnostics } = createApp();
const stores = diagnostics.stores();
// -> [{ id, label, snapshot, history }, ... ]

const requests = diagnostics.requests();
// -> [{ id, path, status, logs, metadata, ... }, ... ]
```

Stores whose `label` starts with `request:` represent in-flight or completed requests, ready for live dashboards.

## Request validation

Provide Zod or Joi schemas directly to the HTTP decorators – the framework will validate `params`, `query`, and `body` before your handler executes:

```ts
@Post({
  path: '/users',
  validate: {
    body: z.object({ email: z.string().email(), name: z.string().min(1) })
  }
})
createUser(req: Request, res: Response) {
  return this.created(res, req.body);
}
```

If validation fails, the request short-circuits with a structured `VALIDATION_ERROR` payload and a 400 response.

## Route uniqueness

`registerControllers` hashes every `[METHOD] path` combination to block duplicate routes. If two handlers resolve to the same normalized path, the framework throws a `ROUTE_CONFLICT` error during bootstrap so you catch collisions early.

## Sample projects

- `examples/basic-todo` – minimal CRUD organised as `src/(controllers|services|domain)` (`node --loader ts-node/esm examples/basic-todo/index.ts`).
- `examples/medium-kanban` – workflow + metrics sample with the same structure (`node --loader ts-node/esm examples/medium-kanban/index.ts`).
- `examples/complex-analytics` – reactive event DB + aggregations with an additional `src/db/` layer (`node --loader ts-node/esm examples/complex-analytics/index.ts`).

Additional internal documentation describing the folder layout lives in `docs/structure.md`.

## Development scripts

- `npm run dev` – run the sample app (`src/main.ts`) with hot reload
- `npm run build` – bundle library to `dist/`
- `npm run check` – type-check
- `npm test` – runs Vitest against the integration-style specs

## CI & release pipeline

`.github/workflows/release.yml` performs type-checking, tests, and build on pushes to `main`. Publishing happens automatically when:

1. A GitHub release is published, or
2. The workflow is dispatched manually with `publish=true`.

Configure the `NPM_TOKEN` repository secret before triggering the publish job.
