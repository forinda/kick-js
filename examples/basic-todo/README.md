# Todo sample app

Minimal example showing how to build a feature module on top of the framework:

```bash
node --loader ts-node/esm examples/basic-todo/index.ts
```

The sample binds a `TodoService` that stores its state in the shared reactive registry and exposes CRUD-style endpoints via `TodoController`.

- `src/services/todo.service.ts` — uses `createReactive` to manage the todo list and logs state changes.
- `src/controllers/todo.controller.ts` — demonstrates `@Controller`, HTTP method decorators with Zod validation, and `BaseController` helpers.
- `index.ts` — configures the global prefix, binds the todo service, and boots the server.
