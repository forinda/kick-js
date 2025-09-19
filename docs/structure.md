# Codebase structure

The framework is organised into layered folders that keep application concepts separate from infrastructure details:

- **src/core/** – runtime primitives used at request time (application bootstrap, request tracker, diagnostics, base controller, router).
- **src/decorators/** – public decorators for controllers and routes. They capture metadata, optional schemas, and auto-register classes.
- **src/infrastructure/** – composition root pieces such as the default Inversify container bindings.
- **src/shared/** – shared tokens and configuration helpers (`TYPES`, config resolvers, state shapes).
- **src/utils/** – internal utilities (reactive store helper, error helpers, logger, DI wrappers).
- **examples/** – sample applications demonstrating usage of the framework (`basic-todo`, `medium-kanban`, `complex-analytics`) each organised with `src/controllers`, `src/services`, `src/domain`, and app-specific folders (e.g. `src/db/`).
- **tests/** – split test suites (`routing.test.ts`, `errors.test.ts`, `validation.test.ts`) covering routing behavior, error propagation, and schema validation respectively.

Key files:

- `src/core/application.ts` – entry for `createApp`/`bootstrap`, resolving configuration and wiring middleware.
- `src/core/server.ts` – registers controllers, applies schema validation, and ensures route uniqueness by hashing method + path.
- `src/core/request-tracker.ts` – attaches per-request reactive state, records logs, responses, and errors.
- `src/utils/reactive.ts` – internal reactive helper used for application state and services.
- `src/index.ts` – public API surface exported by the package.

Each folder stays purpose-specific so external consumers interact mainly with decorators, base controller, configuration helpers, and diagnostics, while the internals remain swappable.
