# Medium Kanban example

Demonstrates a slightly richer API with workflow transitions and metrics.

Endpoints:

- `GET /api/board/tasks` – lists tasks with aggregate metrics.
- `POST /api/board/tasks` – adds a task (`{ title, description? }`).
- `PATCH /api/board/tasks/:id/transition` – move a task forward/back (`{ direction: "forward" | "back" }`).
- `DELETE /api/board/tasks/:id` – removes a task.

Key files:

- `src/services/board.service.ts` – maintains reactive task state and derived metrics.
- `src/controllers/board.controller.ts` – exposes task lifecycle endpoints and logs request metadata.
- `index.ts` – wires the module into the framework container.

The `BoardService` maintains reactive state for tasks plus derived metrics tracked via a watcher. Each controller action logs metadata into the request tracker for devtools inspection.
