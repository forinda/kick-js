# Kick

Opinionated Express + TypeScript framework starter that feels like Spring Boot: decorator-driven controllers, configuration-first bootstrap, and fully instrumented telemetry ready for custom devtools.

## Highlights

- Spring Boot-style controllers via `@Controller`, `@Get`, etc., auto-registered at decoration time
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
import 'reflect-metadata';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  BaseController,
  Controller,
  Get,
  Inject,
  RequestTracker,
  TYPES,
  bootstrap,
  configureApp
} from '@forinda/kickjs';

configureApp({ prefix: '/api' });

@Controller('/hello')
class HelloController extends BaseController {
  constructor(@Inject(TYPES.RequestTracker) tracker: RequestTracker) {
    super(tracker);
  }

  protected controllerId(): string {
    return 'HelloController';
  }

  @Get({
    path: '/',
    validate: {
      query: z.object({ name: z.string().optional() })
    }
  })
  handle(req: Request, res: Response) {
    const name = typeof req.query.name === 'string' ? req.query.name : 'World';
    this.mergeRequestMetadata(res, { greeted: name });
    return this.ok(res, { message: `Hello ${name}` });
  }
}

bootstrap();
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
  Inject,
  Injectable,
  Optional,
  MultiInject,
  Named,
  Tagged,
  Unmanaged,
  BaseController,
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
- `BaseController`: abstract class with response + logging helpers
- `configureApp(config)`: set global prefix, logging level, telemetry limits, and health endpoint before bootstrapping
- `createApp(options)`: create an Express application with auto-registered controllers (optionally override config per call)
- `bootstrap(options)`: create & start the HTTP server (accepts `port`, config overrides, extra middleware)
- `RequestTracker`: injectable request context tracker used internally by `BaseController`
- `AppDiagnostics`: inspect application/request telemetry without touching internal reactive state
- `createError` / `AppError` / `isAppError`: structured error helpers for consistent codes and statuses
- `TYPES`: symbol map to wire container bindings
- `resetControllerRegistry()` / `resetAppConfig()`: utilities for clearing global state in integration tests

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
- `npm test` – runs TypeScript-powered integration specs via Node's test runner

## CI & release pipeline

`.github/workflows/release.yml` performs type-checking, tests, and build on pushes to `main`. Publishing happens automatically when:

1. A GitHub release is published, or
2. The workflow is dispatched manually with `publish=true`.

Configure the `NPM_TOKEN` repository secret before triggering the publish job.
