# Basic API Example

A Todo CRUD API demonstrating the KickJS framework with DDD architecture.

## Endpoints

```
GET    /api/v1/todos/       List all todos
POST   /api/v1/todos/       Create a todo     { "title": "Buy groceries" }
GET    /api/v1/todos/:id    Get a todo by ID
PUT    /api/v1/todos/:id/toggle  Toggle completed
DELETE /api/v1/todos/:id    Delete a todo
```

## Run

```bash
pnpm install
pnpm dev
```

## Try it

```bash
# Create
curl -X POST http://localhost:3000/api/v1/todos/ \
  -H 'Content-Type: application/json' \
  -d '{"title": "Learn KickJS"}'

# List
curl http://localhost:3000/api/v1/todos/

# Toggle
curl -X PUT http://localhost:3000/api/v1/todos/<id>/toggle
```
